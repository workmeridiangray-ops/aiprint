import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { audit } from './identity';
import { deleteStored } from './files';

export const WARN_DAYS = 7;
const STAFF = ['platform_owner', 'platform_support'];
const DAY = 86400000;

/* ---------- customer library ---------- */
export type LibraryState = 'available' | 'expiring' | 'expired' | 'removed';
export function libraryState(o: { expires_at: Date | string; revoked_at: unknown; purged_at: unknown }, now = new Date()): { state: LibraryState; daysLeft: number | null } {
  if (o.revoked_at || o.purged_at) return { state: 'removed', daysLeft: null };
  const ms = new Date(o.expires_at).getTime() - now.getTime();
  if (ms <= 0) return { state: 'expired', daysLeft: 0 };
  const daysLeft = Math.ceil(ms / DAY);
  return { state: ms <= WARN_DAYS * DAY ? 'expiring' : 'available', daysLeft };
}
/** Own outputs, plus outputs of projects shared with me in an organisation I still belong to. Nothing else. */
export async function listLibrary(actor: Actor) {
  const r = await getPool().query(`
    select o.id, o.format, o.colour, o.width_px, o.height_px, o.sha256, o.validated_at, o.created_at, o.expires_at, o.revoked_at, o.purged_at, o.job_id,
           p.id as project_id, p.name as project_name, p.org_id, (p.owner_user_id=$2) as mine,
           exists (select 1 from retention_holds h where h.output_id=o.id and h.released_at is null) as on_hold
    from outputs o join jobs j on j.id=o.job_id join reservations rs on rs.id=j.reservation_id join quotes q on q.id=rs.quote_id join projects p on p.id=q.project_id
    where p.tenant_id=$1 and (
      (p.owner_user_id=$2 and (p.org_id is null or exists (select 1 from org_members m where m.org_id=p.org_id and m.user_id=$2 and m.revoked_at is null)))
      or (p.visibility='shared' and exists (select 1 from org_members m where m.org_id=p.org_id and m.user_id=$2 and m.revoked_at is null)))
    order by o.created_at desc limit 200`, [actor.tenantId, actor.userId]);
  return r.rows.map(o => ({
    id: o.id as string, projectId: o.project_id as string, projectName: o.project_name as string, format: o.format as string, colour: o.colour as string, widthPx: o.width_px as number, heightPx: o.height_px as number,
    createdAt: new Date(o.created_at).toISOString(), expiresAt: new Date(o.expires_at).toISOString(), mine: o.mine as boolean, validatedAt: new Date(o.validated_at).toISOString(),
    checksum: o.sha256 as string, jobId: o.job_id as string, ...libraryState(o),
  }));
}
/** Customer-requested deletion: links stop working immediately; the live copy is purged by the next retention run (within the seven-day promise) unless a hold applies. Financial records are untouched. */
export async function requestDeletion(actor: Actor, outputId: string) {
  return tx(async c => {
    const r = await c.query(`select o.id, o.revoked_at, o.purged_at, p.owner_user_id, p.tenant_id, p.org_id from outputs o join jobs j on j.id=o.job_id join reservations rs on rs.id=j.reservation_id join quotes q on q.id=rs.quote_id join projects p on p.id=q.project_id where o.id=$1 for update of o`, [outputId]);
    const o = r.rows[0];
    if (!o || o.tenant_id !== actor.tenantId || o.owner_user_id !== actor.userId) throw new AppError('not_found', 'File not found', 404);
    if (o.org_id && !(await c.query('select 1 from org_members where org_id=$1 and user_id=$2 and revoked_at is null', [o.org_id, actor.userId])).rowCount) throw new AppError('not_found', 'File not found', 404);
    if (!o.revoked_at && !o.purged_at) { await c.query('update outputs set revoked_at=now() where id=$1', [outputId]); await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'output.delete_requested', type: 'output', id: outputId, outcome: 'revoked' }); }
    return { status: 'removal_requested' as const };
  });
}

/* ---------- holds (platform staff) ---------- */
export async function placeHold(actor: Actor, outputId: string, reason: string) {
  if (!STAFF.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  if (reason.trim().length < 5) throw new AppError('reason_required', 'Give a reason for the hold');
  return tx(async c => {
    if (!(await c.query('select 1 from outputs where id=$1', [outputId])).rowCount) throw new AppError('not_found', 'File not found', 404);
    const r = await c.query('insert into retention_holds(output_id,reason,placed_by) values($1,$2,$3) on conflict do nothing returning id', [outputId, reason.trim(), actor.userId]);
    await audit(c, { actor: actor.userId, action: 'retention.hold', type: 'output', id: outputId, outcome: r.rowCount ? 'placed' : 'already_held' });
  });
}
export async function releaseHold(actor: Actor, outputId: string) {
  if (!STAFF.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  return tx(async c => {
    const r = await c.query('update retention_holds set released_by=$2, released_at=now() where output_id=$1 and released_at is null returning id', [outputId, actor.userId]);
    if (!r.rowCount) throw new AppError('not_found', 'No active hold', 404);
    await audit(c, { actor: actor.userId, action: 'retention.release', type: 'output', id: outputId, outcome: 'released' });
  });
}

/* ---------- scheduled retention: warnings and purge. Pure function of `now`; safe to rerun. ---------- */
export async function runRetention(now = new Date()) {
  const out = { warned: 0, purged: 0, failed: 0, heldSkipped: 0 };
  const due = await getPool().query(`select o.id, o.expires_at, u.email from outputs o join users u on u.id=o.owner_user_id
    where o.purged_at is null and o.revoked_at is null and o.expires_at > $1 and o.expires_at <= $1::timestamptz + interval '${WARN_DAYS} days'
      and not exists (select 1 from retention_warnings w where w.output_id=o.id) limit 1000`, [now]);
  for (const o of due.rows) {
    await tx(async c => {
      const ins = await c.query('insert into retention_warnings(output_id) values($1) on conflict do nothing returning 1', [o.id]);
      if (!ins.rowCount) return;
      await c.query("insert into email_outbox(to_email,template,body) values($1,'retention_warning',$2)", [o.email, JSON.stringify({ outputId: o.id, expiresAt: o.expires_at })]);
      out.warned++;
    });
  }
  const cand = await getPool().query(`select o.id, exists (select 1 from retention_holds h where h.output_id=o.id and h.released_at is null) as held
    from outputs o where o.purged_at is null and (o.revoked_at is not null or o.expires_at <= $1) order by o.expires_at limit 500`, [now]);
  for (const c0 of cand.rows) {
    if (c0.held) { out.heldSkipped++; continue; }
    try {
      await tx(async c => {
        const r = await c.query(`select o.id, o.file_id, f.storage_key, exists (select 1 from retention_holds h where h.output_id=o.id and h.released_at is null) as held
          from outputs o join stored_files f on f.id=o.file_id where o.id=$1 and o.purged_at is null for update of o skip locked`, [c0.id]);
        const o = r.rows[0]; if (!o || o.held) return;
        await deleteStored(o.storage_key); // external side effect; ENOENT counts as done, so a crash between delete and commit is safe to rerun
        await c.query('update stored_files set deleted_at=now() where id=$1', [o.file_id]);
        await c.query('delete from output_previews where output_id=$1', [o.id]);
        await c.query('update outputs set purged_at=now(), purge_error=null where id=$1', [o.id]);
        await audit(c, { action: 'output.purged', type: 'output', id: o.id, outcome: 'ok' });
        out.purged++;
      });
    } catch (e: any) {
      out.failed++;
      await getPool().query('update outputs set purge_attempts=purge_attempts+1, purge_error=$2 where id=$1', [c0.id, String(e?.message ?? e).slice(0, 300)]);
    }
  }
  return out;
}

/** Wraps scheduled work so the last run and result are recorded, and failures are visible. */
export async function recordRun<T>(task: string, fn: () => Promise<T>) {
  const r = await getPool().query('insert into job_runs(task) values($1) returning id', [task]);
  try { const res = await fn(); await getPool().query('update job_runs set finished_at=now(), ok=true, summary=$2 where id=$1', [r.rows[0].id, JSON.stringify(res)]); return res; }
  catch (e: any) { await getPool().query('update job_runs set finished_at=now(), ok=false, error=$2 where id=$1', [r.rows[0].id, String(e?.message ?? e).slice(0, 500)]); throw e; }
}
export async function lastRuns(actor: Actor) {
  if (!STAFF.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  const r = await getPool().query(`select distinct on (task) task, started_at, finished_at, ok, summary, error from job_runs order by task, started_at desc`);
  const stuck = await getPool().query("select count(*)::int n from outputs where purge_error is not null and purged_at is null");
  return { runs: r.rows, outputsFailingPurge: stuck.rows[0].n as number };
}

/* ---------- customer statement (own records only) ---------- */
export async function myTransactions(actor: Actor) {
  const r = await getPool().query(`select rs.created_at as date, p.name as project, rs.customer_paise as amount, rs.status, (la.org_id is not null) as organisation, rs.released_at
    from reservations rs join ledger_accounts la on la.id=rs.customer_account_id join quotes q on q.id=rs.quote_id join projects p on p.id=q.project_id
    where p.tenant_id=$1 and p.owner_user_id=$2 order by rs.created_at desc limit 200`, [actor.tenantId, actor.userId]);
  const acc = await getPool().query("select id from ledger_accounts where tenant_id=$1 and owner_user_id=$2 and kind='customer_service_credit'", [actor.tenantId, actor.userId]);
  let personal = { settled: 0, held: 0, available: 0 };
  if (acc.rowCount) { const { balance } = await import('./ledger'); personal = await balance(acc.rows[0].id); }
  return { personalCredit: personal, rows: r.rows.map(x => ({ date: new Date(x.date).toISOString(), project: x.project as string, amountPaise: Number(x.amount), status: x.status === 'held' ? 'held' : x.status === 'consumed' ? 'charged' : 'released', paidFrom: x.organisation ? 'organisation credit' : 'your credit' })) };
}
