import type pg from 'pg';
import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { audit } from './identity';
import { deleteStored } from './files';

type Q = { query: pg.Pool['query'] };
function need(actor: Actor, roles: string[]) { if (!roles.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403); }
const clean = (s: unknown, max: number) => { const v = String(s ?? '').trim().slice(0, max); return v || null; };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- versioned settings (SC-034) ---------- */
export type SettingsInput = { billingContactName?: string; billingEmail?: string; supportEmail?: string; supportPhone?: string; requireStaffMfa?: boolean };
const rowOut = (r: any) => ({ version: r.version as number, billingContactName: r.billing_contact_name as string | null, billingEmail: r.billing_email as string | null, supportEmail: r.support_email as string | null, supportPhone: r.support_phone as string | null, requireStaffMfa: !!r.require_staff_mfa, changedBy: r.changed_by_email as string | null, createdAt: new Date(r.created_at).toISOString() });

export async function getSettings(actor: Actor) {
  need(actor, ['vendor_admin']);
  const rows = (await getPool().query(`select v.*, u.email as changed_by_email from vendor_settings_versions v left join users u on u.id=v.changed_by where v.tenant_id=$1 order by v.version desc limit 20`, [actor.tenantId])).rows.map(rowOut);
  const noMfa = (await getPool().query("select count(*)::int n from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.role like 'vendor\\_%' and m.revoked_at is null and u.status='active' and u.mfa_enabled_at is null", [actor.tenantId])).rows[0].n as number;
  return { current: rows[0] ?? null, history: rows, staffWithoutMfa: noMfa };
}

/** Saves a new version. `expectedVersion` must be the version the admin was looking at (0 if none), so two admins cannot silently overwrite each other. */
export async function saveSettings(actor: Actor, input: SettingsInput, expectedVersion: number) {
  need(actor, ['vendor_admin']);
  const be = clean(input.billingEmail, 160), se = clean(input.supportEmail, 160);
  if (be && !EMAIL.test(be)) throw new AppError('invalid_email', 'Billing email does not look like an email address');
  if (se && !EMAIL.test(se)) throw new AppError('invalid_email', 'Support email does not look like an email address');
  const phone = clean(input.supportPhone, 30); if (phone && !/^[0-9+()\-\s.]{5,30}$/.test(phone)) throw new AppError('invalid_phone', 'Support phone can only contain digits, spaces and + ( ) - .');
  if (input.requireStaffMfa !== undefined && typeof input.requireStaffMfa !== 'boolean') throw new AppError('invalid_request', 'requireStaffMfa must be true or false');
  return tx(async c => {
    await c.query('select 1 from tenants where id=$1 for update', [actor.tenantId]); // serialises concurrent saves
    const cur = (await c.query('select * from vendor_settings_versions where tenant_id=$1 order by version desc limit 1', [actor.tenantId])).rows[0];
    const curV = cur?.version ?? 0;
    if (!Number.isInteger(expectedVersion) || expectedVersion !== curV) throw Object.assign(new AppError('settings_conflict', 'Someone else saved these settings after you opened them. Reload to see the latest version.', 409), { current: curV });
    const next = {
      billing_contact_name: input.billingContactName !== undefined ? clean(input.billingContactName, 120) : cur?.billing_contact_name ?? null,
      billing_email: input.billingEmail !== undefined ? be : cur?.billing_email ?? null,
      support_email: input.supportEmail !== undefined ? se : cur?.support_email ?? null,
      support_phone: input.supportPhone !== undefined ? phone : cur?.support_phone ?? null,
      require_staff_mfa: input.requireStaffMfa ?? cur?.require_staff_mfa ?? false,
    };
    const ins = await c.query('insert into vendor_settings_versions(tenant_id,version,billing_contact_name,billing_email,support_email,support_phone,require_staff_mfa,changed_by) values($1,$2,$3,$4,$5,$6,$7,$8) returning version',
      [actor.tenantId, curV + 1, next.billing_contact_name, next.billing_email, next.support_email, next.support_phone, next.require_staff_mfa, actor.userId]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'vendor.settings_saved', type: 'tenant', id: actor.tenantId, outcome: `v${ins.rows[0].version}${cur && cur.require_staff_mfa !== next.require_staff_mfa ? (next.require_staff_mfa ? ', staff two-step required' : ', staff two-step no longer required') : ''}` });
    return { version: ins.rows[0].version as number };
  });
}

/* ---------- closure (WF-03) ---------- */
export const NOTICE_DAYS = () => Math.max(0, Number(process.env.CLOSURE_NOTICE_DAYS ?? 14));
export const CLOSED_PURGE_DAYS = () => Math.max(0, Number(process.env.CLOSED_STORE_PURGE_DAYS ?? 7));

/** What stands between a store and closing. Money cannot be moved by this system yet, so a non-zero balance needs a recorded manual settlement. */
export async function liabilities(c: Q, tenantId: string) {
  const one = async (sql: string) => (await c.query(sql, [tenantId])).rows[0].n as number;
  const activeJobs = await one("select count(*)::int n from jobs where tenant_id=$1 and status in ('awaiting_funds','reserved','queued','running','cancellation_requested')");
  const heldReservations = await one("select count(*)::int n from reservations rs join quotes q on q.id=rs.quote_id where q.tenant_id=$1 and rs.status='held'");
  const bal = (await c.query('select a.kind, coalesce(sum(e.amount_paise),0)::bigint as total from ledger_accounts a left join ledger_entries e on e.account_id=a.id where a.tenant_id=$1 group by a.kind', [tenantId])).rows;
  const balances: Record<string, number> = { vendor_processing_credit: 0, customer_service_credit: 0, organisation_service_credit: 0 };
  for (const b of bal) balances[b.kind] = Number(b.total);
  const openTickets = await one("select count(*)::int n from tickets where tenant_id=$1 and status in ('open','awaiting_requester','escalated')");
  const openClaims = await one("select count(*)::int n from walkin_claims where tenant_id=$1 and status in ('pending','conflict')");
  const activeHolds = await one('select count(*)::int n from retention_holds h join outputs o on o.id=h.output_id where o.tenant_id=$1 and h.released_at is null');
  const blockers: string[] = [];
  if (activeJobs) blockers.push(`${activeJobs} job${activeJobs === 1 ? ' is' : 's are'} still waiting or running`);
  if (heldReservations) blockers.push(`${heldReservations} credit hold${heldReservations === 1 ? ' is' : 's are'} still open`);
  const needsSettlement = Object.values(balances).some(v => v !== 0);
  return { activeJobs, heldReservations, balancesPaise: balances, openTickets, openClaims, activeHolds, blockers, needsSettlement };
}

async function queueCustomerEmails(c: Q, tenantId: string, template: string, body: object) {
  await c.query("insert into email_outbox(to_email,template,body) select u.email,$2,$3 from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.role='customer' and m.revoked_at is null and u.status='active' and u.closed_at is null", [tenantId, template, JSON.stringify(body)]);
}

export async function requestClosure(actor: Actor, reason: string) {
  need(actor, ['vendor_admin']);
  const why = String(reason ?? '').trim().slice(0, 300);
  if (why.length < 5) throw new AppError('reason_required', 'Tell us why you are closing (at least 5 characters)');
  return tx(async c => {
    const t = (await c.query('select kind, status from tenants where id=$1 for update', [actor.tenantId])).rows[0];
    if (!t || t.kind !== 'vendor') throw new AppError('not_allowed', 'This workspace cannot be closed here', 403);
    if (t.status === 'closing') throw new AppError('already_requested', 'A closure is already in progress', 409);
    if (t.status !== 'active') throw new AppError('not_allowed', 'Only an active store can request closure', 409);
    const earliest = new Date(Date.now() + NOTICE_DAYS() * 86400_000);
    const ins = await c.query('insert into vendor_closures(tenant_id,reason,requested_by,earliest_close_at) values($1,$2,$3,$4) returning id', [actor.tenantId, why, actor.userId, earliest]);
    await c.query("update tenants set status='closing' where id=$1", [actor.tenantId]); // new work stops now (canProcess needs 'active')
    await queueCustomerEmails(c, actor.tenantId, 'store_closing', { earliest: earliest.toISOString() });
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'closure.request', type: 'vendor_closure', id: ins.rows[0].id, outcome: 'ok' });
    return { id: ins.rows[0].id as string, earliestCloseAt: earliest.toISOString(), liabilities: await liabilities(c, actor.tenantId) };
  });
}

export async function cancelClosure(actor: Actor) {
  need(actor, ['vendor_admin']);
  return tx(async c => {
    await c.query('select 1 from tenants where id=$1 for update', [actor.tenantId]);
    const cl = (await c.query("select id from vendor_closures where tenant_id=$1 and status='requested' for update", [actor.tenantId])).rows[0];
    if (!cl) throw new AppError('not_found', 'No closure is in progress', 404);
    await c.query("update vendor_closures set status='cancelled', cancelled_by=$2, cancelled_at=now() where id=$1", [cl.id, actor.userId]);
    await c.query("update tenants set status='active' where id=$1 and status='closing'", [actor.tenantId]);
    await queueCustomerEmails(c, actor.tenantId, 'store_closing_cancelled', {});
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'closure.cancel', type: 'vendor_closure', id: cl.id, outcome: 'ok' });
    return { ok: true };
  });
}

export async function closureStatus(actor: Actor) {
  need(actor, ['vendor_admin']);
  const t = (await getPool().query('select status from tenants where id=$1', [actor.tenantId])).rows[0];
  const cl = (await getPool().query('select id, status, reason, requested_at, earliest_close_at from vendor_closures where tenant_id=$1 order by requested_at desc limit 1', [actor.tenantId])).rows[0];
  return { tenantStatus: t.status as string, noticeDays: NOTICE_DAYS(), closure: cl ? { id: cl.id as string, status: cl.status as string, reason: cl.reason as string, requestedAt: new Date(cl.requested_at).toISOString(), earliestCloseAt: new Date(cl.earliest_close_at).toISOString() } : null, liabilities: await liabilities(getPool(), actor.tenantId) };
}

/** Platform owner (operations with finance) lists closures that need action, with what is still open. */
export async function listClosures(actor: Actor) {
  need(actor, ['platform_owner']);
  const rows = (await getPool().query(`select c.id, c.tenant_id, c.status, c.reason, c.requested_at, c.earliest_close_at, c.closed_at, c.settlement_note, c.purge_after, c.purged_at, c.purge_note, t.name from vendor_closures c join tenants t on t.id=c.tenant_id where c.status in ('requested','closed') order by c.requested_at desc limit 100`)).rows;
  const out = [];
  for (const r of rows) out.push({ id: r.id as string, tenantId: r.tenant_id as string, tenantName: r.name as string, status: r.status as string, reason: r.reason as string, requestedAt: new Date(r.requested_at).toISOString(), earliestCloseAt: new Date(r.earliest_close_at).toISOString(), closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null, settlementNote: r.settlement_note as string | null, purgeAfter: r.purge_after ? new Date(r.purge_after).toISOString() : null, purgedAt: r.purged_at ? new Date(r.purged_at).toISOString() : null, purgeNote: r.purge_note as string | null, liabilities: r.status === 'requested' ? await liabilities(getPool(), r.tenant_id) : null });
  return out;
}

/** Completes a closure. Refused until the notice period has passed, while jobs or credit holds are open, and (for any non-zero balance) without a written note saying how it was settled outside the platform.
 *  The balances at that moment are stored with the closure; ledger and audit rows are never deleted. */
export async function completeClosure(actor: Actor, closureId: string, settlementNote?: string) {
  need(actor, ['platform_owner']);
  const note = String(settlementNote ?? '').trim().slice(0, 500);
  return tx(async c => {
    const cl = (await c.query("select * from vendor_closures where id=$1 for update", [closureId])).rows[0];
    if (!cl) throw new AppError('not_found', 'Closure not found', 404);
    if (cl.status !== 'requested') throw new AppError('already_decided', 'This closure is not waiting for completion', 409);
    await c.query('select 1 from tenants where id=$1 for update', [cl.tenant_id]);
    if (new Date(cl.earliest_close_at) > new Date()) throw new AppError('notice_period', `The notice period runs until ${new Date(cl.earliest_close_at).toLocaleDateString('en-IN')}. Customers need that time to download their files.`, 409);
    const l = await liabilities(c, cl.tenant_id);
    if (l.blockers.length) throw new AppError('liabilities_open', `Cannot close yet: ${l.blockers.join('; ')}.`, 409);
    if (l.needsSettlement && note.length < 10) throw new AppError('settlement_note_required', 'This store still has credit balances. Write how they were settled outside the platform (for example the refund reference), at least 10 characters.', 409);
    const purgeAfter = new Date(Date.now() + CLOSED_PURGE_DAYS() * 86400_000);
    await c.query("update tenants set status='closed' where id=$1", [cl.tenant_id]);
    await c.query("update vendor_closures set status='closed', closed_by=$2, closed_at=now(), settlement_note=$3, liabilities_at_close=$4, purge_after=$5 where id=$1", [cl.id, actor.userId, note || null, JSON.stringify(l), purgeAfter]);
    await audit(c, { actor: actor.userId, tenant: cl.tenant_id, action: 'closure.complete', type: 'vendor_closure', id: cl.id, outcome: l.needsSettlement ? 'closed with balances settled outside the platform' : 'closed' });
    return { ok: true, purgeAfter: purgeAfter.toISOString(), liabilities: l };
  });
}

/** Scheduled: after the purge delay, delete the live files of closed stores. A retention hold pauses the purge. Ledger, payments and audit records stay. Safe to rerun. */
export async function purgeClosedStores(now = new Date()) {
  const out = { purged: 0, held: 0, failed: 0 };
  const due = (await getPool().query("select id, tenant_id from vendor_closures where status='closed' and purged_at is null and purge_after <= $1 limit 20", [now])).rows;
  for (const d of due) {
    const held = (await getPool().query('select 1 from retention_holds h join outputs o on o.id=h.output_id where o.tenant_id=$1 and h.released_at is null limit 1', [d.tenant_id])).rowCount;
    if (held) { await getPool().query("update vendor_closures set purge_note='paused: investigation hold' where id=$1", [d.id]); out.held++; continue; }
    try {
      const files = (await getPool().query('select id, storage_key from stored_files where tenant_id=$1 and deleted_at is null', [d.tenant_id])).rows;
      for (const f of files) { await deleteStored(f.storage_key); await getPool().query('update stored_files set deleted_at=now() where id=$1', [f.id]); }
      await getPool().query('delete from output_previews where output_id in (select id from outputs where tenant_id=$1)', [d.tenant_id]);
      await getPool().query('update outputs set purged_at=now() where tenant_id=$1 and purged_at is null', [d.tenant_id]);
      await getPool().query("update account_requests set export_data=null where user_id in (select user_id from memberships where tenant_id=$1)", [d.tenant_id]);
      await getPool().query("update vendor_closures set purged_at=$2, purge_note=$3 where id=$1", [d.id, now, `${files.length} files deleted; ledger, payment records and audit log kept`]);
      await audit(getPool() as any, { tenant: d.tenant_id, action: 'tenant.purged', type: 'vendor_closure', id: d.id, outcome: `${files.length} files` }); out.purged++;
    } catch (e: any) { out.failed++; await getPool().query('update vendor_closures set purge_note=$2 where id=$1', [d.id, 'failed, will retry: ' + String(e?.message ?? e).slice(0, 200)]); }
  }
  return out;
}
