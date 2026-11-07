import { getPool, tx, AppError } from './db';
import { verifyPassword, type Actor } from './auth';
import { keys, lockKey, assertNotLocked, recordFailure, proveTotp } from './mfa';
import { deleteStored } from './files';
import { available } from './ledger';
import { autoCloseResolved } from './support';

const ACTIVE_JOB = "('awaiting_funds','reserved','queued','running','cancellation_requested')";
export const EXPORT_DAYS = 7, CONFIRM_MINUTES = 30, PURGE_DAYS = 7;
type C = { query: (sql: string, p?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };
const audit = (c: C, a: { actor?: string | null; tenant?: string | null; action: string; id: string; outcome: string }) =>
  c.query('insert into audit_log(actor_user_id,tenant_id,action,object_type,object_id,outcome) values($1,$2,$3,$4,$5,$6)', [a.actor ?? null, a.tenant ?? null, a.action, 'user', a.id, a.outcome.slice(0, 200)]);
const iso = (d: unknown) => (d ? new Date(String(d)).toISOString() : null);
const rupees = (p: number) => `₹${(p / 100).toFixed(2)}`;

/* ---------- export (own data only; artwork files stay in the library while retained) ---------- */
export async function requestExport(actor: Actor) {
  if (actor.role !== 'customer') throw new AppError('denied', 'Export is available to customer accounts', 403);
  const p = getPool();
  const recent = (await p.query("select id, expires_at from account_requests where user_id=$1 and kind='export' and status='ready' and created_at > now() - interval '24 hours' order by created_at desc limit 1", [actor.userId])).rows[0];
  if (recent) return { id: recent.id as string, expiresAt: iso(recent.expires_at)!, reused: true };
  const q = (s: string) => p.query(s, [actor.userId, actor.tenantId]).then(r => r.rows);
  const data = {
    generatedAt: new Date().toISOString(),
    note: 'This file lists your account records. Your artwork files are not inside it: download them from Your files while they are kept (90 days). Records of payments are kept by us separately and are listed here for your information.',
    account: await p.query('select email, created_at from users where id=$1', [actor.userId]).then(r => ({ email: r.rows[0].email, createdAt: iso(r.rows[0].created_at) })),
    projects: (await q('select id,name,settings,created_at,updated_at from projects where owner_user_id=$1 and tenant_id=$2 order by created_at')).map(r => ({ id: r.id, name: r.name, settings: r.settings, createdAt: iso(r.created_at), updatedAt: iso(r.updated_at) })),
    quotes: (await q('select q.id,q.project_id,q.customer_amount_paise,q.created_at from quotes q join projects p on p.id=q.project_id where p.owner_user_id=$1 and p.tenant_id=$2 order by q.created_at')).map(r => ({ id: r.id, projectId: r.project_id, amount: rupees(Number(r.customer_amount_paise)), createdAt: iso(r.created_at) })),
    charges: (await q('select r.id,r.status,r.customer_paise,r.created_at from reservations r join quotes q on q.id=r.quote_id join projects p on p.id=q.project_id where p.owner_user_id=$1 and p.tenant_id=$2 order by r.created_at')).map(r => ({ id: r.id, status: r.status, amount: rupees(Number(r.customer_paise)), createdAt: iso(r.created_at) })),
    files: (await q('select o.id,o.format,o.width_px,o.height_px,o.created_at,o.expires_at,o.revoked_at,o.purged_at from outputs o where o.owner_user_id=$1 and o.tenant_id=$2 order by o.created_at')).map(r => ({ id: r.id, format: r.format, widthPx: r.width_px, heightPx: r.height_px, createdAt: iso(r.created_at), expiresAt: iso(r.expires_at), removed: !!(r.revoked_at || r.purged_at) })),
    supportTickets: await Promise.all((await q('select id,reference,subject,status,created_at from tickets where requester_id=$1 and tenant_id=$2 order by created_at')).map(async t => ({ reference: t.reference, subject: t.subject, status: t.status, createdAt: iso(t.created_at), messages: (await p.query("select body,created_at from ticket_messages where ticket_id=$1 and kind='public' order by id", [t.id])).rows.map(m => ({ at: iso(m.created_at), text: m.body })) }))), // public messages only; staff notes are never exported
  };
  const r = (await p.query(`insert into account_requests(user_id,tenant_id,kind,status,export_data,expires_at) values($1,$2,'export','ready',$3, now() + interval '${EXPORT_DAYS} days') returning id, expires_at`, [actor.userId, actor.tenantId, JSON.stringify(data)])).rows[0];
  await audit(p as any, { actor: actor.userId, tenant: actor.tenantId, action: 'account.export', id: actor.userId, outcome: 'ready' });
  return { id: r.id as string, expiresAt: iso(r.expires_at)!, reused: false };
}
export async function downloadExport(actor: Actor, id: string) {
  const r = (await getPool().query("select export_data from account_requests where id=$1 and user_id=$2 and tenant_id=$3 and kind='export' and status='ready' and expires_at>now()", [id, actor.userId, actor.tenantId])).rows[0];
  if (!r) throw new AppError('not_found', 'Export not found or expired', 404);
  await audit(getPool() as any, { actor: actor.userId, tenant: actor.tenantId, action: 'account.export_download', id: actor.userId, outcome: 'ok' });
  return r.export_data;
}

/* ---------- closure ---------- */
export type Liability = { code: 'active_jobs' | 'held_funds' | 'credit_balance' | 'org_admin'; message: string };
async function liabilities(c: C, userId: string, tenantId: string): Promise<Liability[]> {
  const out: Liability[] = [];
  const jobs = (await c.query(`select count(*)::int n from jobs j join reservations r on r.id=j.reservation_id join quotes q on q.id=r.quote_id join projects p on p.id=q.project_id where p.owner_user_id=$1 and p.tenant_id=$2 and j.status in ${ACTIVE_JOB}`, [userId, tenantId])).rows[0].n;
  if (jobs) out.push({ code: 'active_jobs', message: `${jobs} job${jobs === 1 ? ' is' : 's are'} still running or waiting. Let them finish or cancel them first.` });
  const held = (await c.query("select count(*)::int n from reservations r join quotes q on q.id=r.quote_id join projects p on p.id=q.project_id where p.owner_user_id=$1 and p.tenant_id=$2 and r.status='held'", [userId, tenantId])).rows[0].n;
  if (held) out.push({ code: 'held_funds', message: 'Some of your credit is held for work that has not finished.' });
  const acc = (await c.query("select id from ledger_accounts where tenant_id=$1 and owner_user_id=$2 and kind='customer_service_credit'", [tenantId, userId])).rows[0];
  if (acc) { const b = await available(c as any, acc.id); if (b.settled > 0) out.push({ code: 'credit_balance', message: `You still have ${rupees(b.settled)} of credit. An account with money on it cannot be closed: it must be settled with the store first.` }); }
  const orgs = (await c.query("select 1 from org_members where user_id=$1 and role='admin' and revoked_at is null", [userId])).rowCount;
  if (orgs) out.push({ code: 'org_admin', message: 'You administer an organisation. Hand it over or close it first.' });
  return out;
}
export async function closureStatus(actor: Actor) {
  const r = (await getPool().query("select id,status,liabilities,expires_at from account_requests where user_id=$1 and kind='closure' order by created_at desc limit 1", [actor.userId])).rows[0];
  return r ? { id: r.id as string, status: (r.status === 'awaiting_confirmation' && new Date(r.expires_at) <= new Date() ? 'expired' : r.status) as string, liabilities: r.liabilities as Liability[] } : null;
}
export async function requestClosure(actor: Actor, reason: string) {
  if (actor.role !== 'customer') throw new AppError('denied', 'Store and platform accounts are closed through the platform owner', 403);
  return tx(async c => {
    await c.query('select 1 from users where id=$1 for update', [actor.userId]);
    const l = await liabilities(c, actor.userId, actor.tenantId);
    const status = l.length ? 'blocked' : 'awaiting_confirmation';
    const r = (await c.query(`insert into account_requests(user_id,tenant_id,kind,status,reason,liabilities,expires_at) values($1,$2,'closure',$3,$4,$5, ${l.length ? 'null' : `now() + interval '${CONFIRM_MINUTES} minutes'`}) returning id`,
      [actor.userId, actor.tenantId, status, String(reason ?? '').trim().slice(0, 500) || null, JSON.stringify(l)])).rows[0];
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'account.closure_request', id: actor.userId, outcome: status });
    return { id: r.id as string, status: status as 'blocked' | 'awaiting_confirmation', liabilities: l };
  });
}
/** Final step: re-checks everything, re-verifies the password (and the authenticator code if on), then stops all access at once.
 *  Money records, tickets and the audit log stay. Files are deleted by the scheduled purge after a short delay unless a hold applies. */
export async function confirmClosure(actor: Actor, requestId: string, password: string, code?: string) {
  const p = getPool();
  const u = (await p.query('select email,password_hash,mfa_enabled_at from users where id=$1', [actor.userId])).rows[0];
  const k = keys(u.email, 'closure:' + actor.userId);
  await tx(async c => { await lockKey(c, k); await assertNotLocked(c, k); });
  if (!verifyPassword(String(password ?? ''), u.password_hash)) { await recordFailure(p as any, k); throw new AppError('invalid_credentials', 'Password is incorrect', 401); }
  return tx(async c => {
    const req = (await c.query("select id,status,expires_at from account_requests where id=$1 and user_id=$2 and kind='closure' for update", [requestId, actor.userId])).rows[0];
    if (!req || req.status !== 'awaiting_confirmation' || new Date(req.expires_at) <= new Date()) throw new AppError('request_expired', 'This closure request is no longer valid. Start again.', 409);
    if (u.mfa_enabled_at) {
      try { await proveTotp(c, actor.userId, String(code ?? '')); }
      catch (e) { await recordFailure(p as any, k); throw e; }
    }
    await c.query('select 1 from users where id=$1 for update', [actor.userId]);
    const l = await liabilities(c, actor.userId, actor.tenantId);
    if (l.length) { await c.query("update account_requests set status='blocked', liabilities=$2 where id=$1", [requestId, JSON.stringify(l)]); return { status: 'blocked' as const, liabilities: l }; }
    await c.query("insert into email_outbox(to_email,template,body) values($1,'account_closed','{}')", [u.email]);
    await c.query("update users set status='disabled', closed_at=now() where id=$1", [actor.userId]);
    await c.query('delete from sessions where user_id=$1', [actor.userId]);
    await c.query('update memberships set revoked_at=now() where user_id=$1 and revoked_at is null', [actor.userId]);
    await c.query('update org_members set revoked_at=now() where user_id=$1 and revoked_at is null', [actor.userId]);
    await c.query("update auth_tokens set revoked_at=now() where user_id=$1 and used_at is null and revoked_at is null", [actor.userId]);
    await c.query('update outputs set revoked_at=now() where owner_user_id=$1 and revoked_at is null and purged_at is null', [actor.userId]);
    await c.query(`update account_requests set status='closed', completed_at=now(), purge_after=now() + interval '${PURGE_DAYS} days', liabilities='[]' where id=$1`, [requestId]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'account.closed', id: actor.userId, outcome: 'ok' });
    return { status: 'closed' as const, purgeInDays: PURGE_DAYS };
  });
}

/* ---------- scheduled ---------- */
/** Deletes live copies of everything a closed account uploaded or produced, once the delay has passed. A hold on any of its files pauses the whole purge. */
export async function purgeClosedAccounts(now = new Date()) {
  const out = { purged: 0, held: 0, failed: 0 };
  const due = (await getPool().query("select id,user_id from account_requests where kind='closure' and status='closed' and purged_at is null and purge_after <= $1 limit 100", [now])).rows;
  for (const r of due) {
    const held = (await getPool().query("select 1 from retention_holds h join outputs o on o.id=h.output_id where o.owner_user_id=$1 and h.released_at is null limit 1", [r.user_id])).rowCount;
    if (held) { await getPool().query("update account_requests set purge_note='paused: investigation hold' where id=$1", [r.id]); out.held++; continue; }
    try {
      const files = (await getPool().query('select id,storage_key from stored_files where owner_user_id=$1 and deleted_at is null', [r.user_id])).rows;
      for (const f of files) { await deleteStored(f.storage_key); await getPool().query('update stored_files set deleted_at=now() where id=$1', [f.id]); }
      await getPool().query("update outputs set purged_at=now() where owner_user_id=$1 and purged_at is null", [r.user_id]);
      await getPool().query("update projects set name='Deleted project' where owner_user_id=$1", [r.user_id]);
      await getPool().query("update account_requests set purged_at=$2, purge_note='files deleted; payment records, tickets and audit log kept' where id=$1", [r.id, now]);
      await audit(getPool() as any, { action: 'account.purged', id: r.user_id, outcome: `${files.length} files` }); out.purged++;
    } catch (e: any) { out.failed++; await getPool().query('update account_requests set purge_note=$2 where id=$1', [r.id, 'failed, will retry: ' + String(e?.message ?? e).slice(0, 200)]); }
  }
  return out;
}
export async function runAccountMaintenance(now = new Date()) {
  const ex = await getPool().query("update account_requests set status='expired', export_data=null where kind='export' and status='ready' and expires_at <= $1", [now]);
  return { exportsExpired: ex.rowCount ?? 0, ...(await purgeClosedAccounts(now)), ...(await autoCloseResolved(now)) };
}
