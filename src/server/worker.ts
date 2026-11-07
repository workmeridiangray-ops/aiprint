import type pg from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { getPool, tx, AppError } from './db';
import { renderExport, validateOutput, FORMATS } from './engine';
import { postEntry } from './ledger';
import { audit } from './identity';
import { validateSettings } from './projects';
import { require as authorize } from './policy';
import type { Actor } from './auth';
import { canReadProject } from './org';

const MAX_ATTEMPTS = 3;
export const RETENTION_DAYS = 90;
function dir() {
  if (process.env.APP_ENV === 'production' && (process.env.STORAGE_DRIVER ?? 'local') === 'local') throw new AppError('storage_not_configured', 'Private object storage is not configured for production', 503);
  return process.env.STORAGE_LOCAL_DIR ?? './.data/files';
}

/** Atomically claim one queued job with a lease. SKIP LOCKED means concurrent workers never take the same job. */
export async function claimJob(workerId: string, leaseSeconds = 60) {
  return tx(async c => {
    const r = await c.query("select id from jobs where status='queued' order by created_at for update skip locked limit 1");
    if (!r.rowCount) return null;
    const id = r.rows[0].id as string;
    const u = await c.query(`update jobs set status='running', attempts=attempts+1, lease_owner=$2, heartbeat_at=now(), lease_expires_at=now() + ($3 || ' seconds')::interval where id=$1 returning attempts`, [id, workerId, String(leaseSeconds)]);
    await c.query('insert into job_attempts(job_id,attempt_no,worker_id) values($1,$2,$3)', [id, u.rows[0].attempts, workerId]);
    return { jobId: id, attempt: u.rows[0].attempts as number };
  });
}
export async function heartbeat(jobId: string, workerId: string, leaseSeconds = 60) {
  const r = await getPool().query("update jobs set heartbeat_at=now(), lease_expires_at=now() + ($3 || ' seconds')::interval where id=$1 and lease_owner=$2 and status='running'", [jobId, workerId, String(leaseSeconds)]);
  return r.rowCount === 1; // false = lease lost; worker must stop
}

/** Finalise success exactly once: output + entitlement + ledger consumption in ONE transaction, gated on lease ownership. Re-running is a no-op. */
async function finalizeSuccess(c: pg.PoolClient, jobId: string, workerId: string, attempt: number, fileId: string, v: { format: string; width: number; height: number; sha256: string }, ownerId: string) {
  const j = await c.query('select j.status, j.lease_owner, j.tenant_id, j.reservation_id, r.customer_account_id, r.vendor_account_id, r.customer_paise, r.vendor_paise from jobs j join reservations r on r.id=j.reservation_id where j.id=$1 for update of j', [jobId]);
  const row = j.rows[0];
  if (row.status === 'succeeded') return false;
  if (row.status !== 'running' && row.status !== 'cancellation_requested' || row.lease_owner !== workerId) throw new AppError('lease_lost', 'Job lease was lost', 409);
  await c.query(`insert into outputs(job_id,tenant_id,owner_user_id,file_id,format,width_px,height_px,sha256,validated_at,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8,now(), now() + ($9 || ' days')::interval)`,
    [jobId, row.tenant_id, ownerId, fileId, v.format, v.width, v.height, v.sha256, String(RETENTION_DAYS)]);
  // Consumption: debit both accounts once (idempotent keys), then mark the hold consumed so it is no longer counted as held.
  if (row.customer_account_id && Number(row.customer_paise) > 0) await postEntry(c, row.customer_account_id, -Number(row.customer_paise), 'job_consumed', `consume:${row.reservation_id}:customer`);
  if (row.vendor_account_id && Number(row.vendor_paise) > 0) await postEntry(c, row.vendor_account_id, -Number(row.vendor_paise), 'job_consumed', `consume:${row.reservation_id}:vendor`);
  await c.query("update reservations set status='consumed' where id=$1", [row.reservation_id]);
  await c.query("update jobs set status='succeeded', finished_at=now(), lease_owner=null, lease_expires_at=null where id=$1", [jobId]);
  await c.query("update job_attempts set finished_at=now(), outcome='succeeded' where job_id=$1 and attempt_no=$2", [jobId, attempt]);
  await audit(c, { tenant: row.tenant_id, action: 'job.succeeded', type: 'job', id: jobId, outcome: 'ok' });
  return true;
}

/** Release the hold and mark failed, only while this worker still owns the lease. */
async function finalizeFailure(jobId: string, workerId: string, attempt: number, err: string) {
  return tx(async c => {
    const j = await c.query('select status, lease_owner, reservation_id, tenant_id from jobs where id=$1 for update', [jobId]);
    const row = j.rows[0];
    if (!row || row.lease_owner !== workerId || !['running', 'cancellation_requested'].includes(row.status)) return;
    const cancelled = row.status === 'cancellation_requested';
    await c.query("update jobs set status=$2, last_error=$3, finished_at=now(), lease_owner=null, lease_expires_at=null where id=$1", [jobId, cancelled ? 'cancelled' : 'failed', err.slice(0, 500)]);
    await c.query("update reservations set status='released', released_at=now() where id=$1 and status='held'", [row.reservation_id]);
    await c.query("update job_attempts set finished_at=now(), outcome='failed', error=$3 where job_id=$1 and attempt_no=$2", [jobId, attempt, err.slice(0, 500)]);
    await audit(c, { tenant: row.tenant_id, action: cancelled ? 'job.cancelled' : 'job.failed', type: 'job', id: jobId, outcome: 'released' });
  });
}

export async function runJob(jobId: string, workerId: string, attempt: number, hooks: { beforeFinalize?: () => Promise<void> } = {}) {
  const p = getPool();
  try {
    const r = await p.query(`select q.settings_snapshot, q.source_file_id, f.storage_key, f.tenant_id, f.owner_user_id, pr.owner_user_id as owner
      from jobs j join reservations rs on rs.id=j.reservation_id join quotes q on q.id=rs.quote_id join stored_files f on f.id=q.source_file_id join projects pr on pr.id=q.project_id where j.id=$1`, [jobId]);
    if (!r.rowCount) throw new Error('job inputs missing');
    const row = r.rows[0];
    const settings = validateSettings(row.settings_snapshot); // immutable quote snapshot, not the live project
    const src = await readFile(path.join(dir(), row.storage_key));
    const out = await renderExport(src, settings);
    const v = await validateOutput(out, settings);
    const key = `${row.tenant_id}/exports/${randomUUID()}.${FORMATS[settings.format].ext}`;
    await mkdir(path.dirname(path.join(dir(), key)), { recursive: true });
    await writeFile(path.join(dir(), key), out, { flag: 'wx' });
    if (hooks.beforeFinalize) await hooks.beforeFinalize();
    return await tx(async c => {
      const f = await c.query(`insert into stored_files(tenant_id,owner_user_id,kind,storage_key,sha256,bytes,width_px,height_px,format) values($1,$2,'export',$3,$4,$5,$6,$7,$8) returning id`,
        [row.tenant_id, row.owner, key, v.sha256, v.bytes, v.width, v.height, v.format]);
      return finalizeSuccess(c, jobId, workerId, attempt, f.rows[0].id, v, row.owner);
    });
  } catch (e: any) {
    if (e instanceof AppError && e.code === 'lease_lost') return false;
    await finalizeFailure(jobId, workerId, attempt, e?.message ?? String(e));
    return false;
  }
}

/** Jobs whose lease expired: the local engine is deterministic and has no external side effect, so requeue (bounded).
 *  If a validated output already exists, finish instead of re-running. A paid external adapter MUST route to needs_review instead. */
export async function reapExpired() {
  return tx(async c => {
    const r = await c.query("select id, attempts, reservation_id, tenant_id from jobs where status='running' and lease_expires_at < now() for update skip locked");
    let requeued = 0, failed = 0;
    for (const j of r.rows) {
      await c.query("update job_attempts set finished_at=now(), outcome='lease_expired' where job_id=$1 and attempt_no=$2 and finished_at is null", [j.id, j.attempts]);
      if (j.attempts >= MAX_ATTEMPTS) {
        await c.query("update jobs set status='failed', last_error='lease expired too many times', finished_at=now(), lease_owner=null, lease_expires_at=null where id=$1", [j.id]);
        await c.query("update reservations set status='released', released_at=now() where id=$1 and status='held'", [j.reservation_id]); failed++;
      } else { await c.query("update jobs set status='queued', lease_owner=null, lease_expires_at=null where id=$1", [j.id]); requeued++; }
    }
    return { requeued, failed };
  });
}

export async function workOnce(workerId: string) {
  const c = await claimJob(workerId); if (!c) return false;
  await runJob(c.jobId, workerId, c.attempt); return true;
}

/** Protected download: owner only, within retention. Re-download is free: no ledger writes happen here. */
export async function readOutput(actor: Actor, outputId: string) {
  const r = await getPool().query(`select o.*, f.storage_key, p.tenant_id as p_tenant, p.owner_user_id as p_owner, p.org_id, p.visibility from outputs o join stored_files f on f.id=o.file_id
    join jobs j on j.id=o.job_id join reservations rs on rs.id=j.reservation_id join quotes q on q.id=rs.quote_id join projects p on p.id=q.project_id where o.id=$1`, [outputId]);
  const o = r.rows[0];
  const nf = () => new AppError('not_found', 'File not found', 404);
  if (!o) throw nf();
  if (!(await canReadProject(getPool(), actor, { tenant_id: o.p_tenant, owner_user_id: o.p_owner, org_id: o.org_id, visibility: o.visibility }))) throw nf();
  if (o.revoked_at || o.purged_at) throw new AppError('removed', 'This file was removed', 410);
  if (new Date(o.expires_at) <= new Date()) throw new AppError('expired', 'This file has passed its retention period', 410);
  const buf = await readFile(path.join(dir(), o.storage_key)).catch(() => { throw new AppError('file_missing', 'The stored file could not be found. Support has been alerted.', 500); });
  const { createHash } = await import('node:crypto');
  if (createHash('sha256').update(buf).digest('hex') !== o.sha256) throw new AppError('integrity_failed', 'The stored file failed its integrity check. Support has been alerted.', 500);
  return { buf, format: o.format as string };
}
export async function jobStatus(actor: Actor, jobId: string) {
  const r = await getPool().query(`select j.status, j.last_error, o.id as output_id, p.tenant_id, p.owner_user_id, p.org_id, p.visibility from jobs j join reservations rs on rs.id=j.reservation_id join quotes q on q.id=rs.quote_id join projects p on p.id=q.project_id left join outputs o on o.job_id=j.id where j.id=$1`, [jobId]);
  const row = r.rows[0];
  if (!row || !(await canReadProject(getPool(), actor, row))) throw new AppError('not_found', 'Job not found', 404);
  return { status: row.status as string, outputId: row.output_id as string | null, message: row.status === 'failed' ? 'Processing failed. You have not been charged.' : null };
}
