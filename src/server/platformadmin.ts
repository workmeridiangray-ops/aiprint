import { randomBytes, createHash } from 'node:crypto';
import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { audit } from './identity';
import { providerStatus, manualSettlement } from './providers';
import { stepUp } from './refunds';

const STAFF = ['platform_owner', 'platform_support'];
const ANY_PLATFORM = ['platform_owner', 'platform_support', 'platform_finance'];
const PLATFORM_ROLES = ['platform_owner', 'platform_finance', 'platform_support'];
const need = (actor: Actor, roles: string[]) => { if (!roles.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403); };
const reasonOf = (s: unknown, min = 10) => { const r = String(s ?? '').trim(); if (r.length < min) throw new AppError('reason_required', `Give a reason of at least ${min} characters`); return r.slice(0, 500); };

/* ---------- stores: review, suspend, reactivate (SC-056, WF-20) ---------- */
export async function tenantDetail(actor: Actor, id: string) {
  need(actor, STAFF);
  const pool = getPool();
  const t = (await pool.query(`select t.id, t.name, t.kind, t.status, t.created_at, t.suspended_reason, t.suspended_at, p.slug, p.support_email, s.status as subscription
    from tenants t left join vendor_profiles p on p.tenant_id=t.id left join subscriptions s on s.tenant_id=t.id where t.id=$1 and t.kind in ('vendor','direct')`, [id])).rows[0];
  if (!t) throw new AppError('not_found', 'Store not found', 404);
  const one = async (sql: string) => Number((await pool.query(sql, [id])).rows[0].n);
  const checklist = [
    { item: 'Administrator email verified', done: (await one("select count(*)::int n from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.role='vendor_admin' and m.revoked_at is null and u.email_verified_at is not null")) > 0 || t.kind === 'direct' },
    { item: 'Customer prices set', done: (await one('select count(*)::int n from vendor_pricing where tenant_id=$1')) > 0 },
    { item: 'Subscription paid', done: t.kind === 'direct' || ['active', 'grace'].includes(t.subscription) },
    { item: 'Payout destination approved', done: t.kind === 'direct' || (await one("select count(*)::int n from beneficiaries where tenant_id=$1 and status='approved'")) > 0 },
  ];
  const staff = (await pool.query("select m.role, count(*)::int n from memberships m where m.tenant_id=$1 and m.revoked_at is null group by m.role order by m.role", [id])).rows;
  return { id: t.id, name: t.name, kind: t.kind, status: t.status, slug: t.slug, subscription: t.subscription, createdAt: t.created_at, suspendedReason: t.suspended_reason, suspendedAt: t.suspended_at, checklist, people: staff.map(s => ({ role: s.role, count: s.n })),
    openJobs: await one("select count(*)::int n from jobs where tenant_id=$1 and status in ('queued','running','cancellation_requested')"), openTickets: await one("select count(*)::int n from tickets where tenant_id=$1 and status not in ('resolved','closed')") };
}
/** Suspension stops all access to the store at once and needs a reason. It deletes nothing: files, ledgers and history stay as they are. */
export async function suspendTenant(actor: Actor, id: string, reason: string) {
  need(actor, STAFF); const why = reasonOf(reason);
  return tx(async c => {
    const t = (await c.query("select status, kind from tenants where id=$1 and kind in ('vendor','direct') for update", [id])).rows[0];
    if (!t) throw new AppError('not_found', 'Store not found', 404);
    if (!['active', 'pending', 'closing'].includes(t.status)) throw new AppError('invalid_transition', `A ${t.status} store cannot be suspended`, 409);
    await c.query("update tenants set status='suspended', suspended_from=$2, suspended_reason=$3, suspended_at=now() where id=$1", [id, t.status, why]);
    await audit(c, { actor: actor.userId, tenant: id, action: 'tenant.suspended', type: 'tenant', id, outcome: 'ok' });
    return { status: 'suspended' };
  });
}
export async function reactivateTenant(actor: Actor, id: string, reason: string) {
  need(actor, ['platform_owner']); reasonOf(reason);
  return tx(async c => {
    const t = (await c.query("select status, suspended_from from tenants where id=$1 for update", [id])).rows[0];
    if (!t) throw new AppError('not_found', 'Store not found', 404);
    if (t.status !== 'suspended') throw new AppError('invalid_transition', 'This store is not suspended', 409);
    await c.query('update tenants set status=$2, suspended_from=null, suspended_reason=null, suspended_at=null where id=$1', [id, t.suspended_from ?? 'active']);
    await audit(c, { actor: actor.userId, tenant: id, action: 'tenant.reactivated', type: 'tenant', id, outcome: 'ok' });
    return { status: t.suspended_from ?? 'active' };
  });
}

/* ---------- people (SC-058): search by email, see memberships, block and unblock. No artwork, files or balances. ---------- */
export async function searchPeople(actor: Actor, q: string) {
  need(actor, STAFF);
  const term = String(q ?? '').trim().toLowerCase();
  if (term.length < 3) throw new AppError('query_too_short', 'Type at least three characters of the email address');
  const pool = getPool();
  const r = await pool.query(`select u.id, u.email, u.status, u.blocked_reason, u.email_verified_at is not null as verified, u.closed_at, u.created_at from users u
    where lower(u.email) like '%' || replace(replace(replace($1,'\\','\\\\'),'%','\\%'),'_','\\_') || '%' order by u.created_at desc limit 25`, [term]);
  const out = [];
  for (const u of r.rows) {
    const ms = (await pool.query('select t.name, t.kind, m.role from memberships m join tenants t on t.id=m.tenant_id where m.user_id=$1 and m.revoked_at is null order by m.created_at', [u.id])).rows;
    out.push({ id: u.id, email: u.email, status: u.status, blockedReason: u.blocked_reason, verified: u.verified, closed: !!u.closed_at, createdAt: u.created_at, memberships: ms.map(m => ({ store: m.name, kind: m.kind, role: m.role })) });
  }
  await audit(pool, { actor: actor.userId, action: 'people.search', outcome: `${out.length} results` }); // the search term is not stored
  return out;
}
export async function blockUser(actor: Actor, userId: string, reason: string) {
  need(actor, STAFF); const why = reasonOf(reason);
  if (userId === actor.userId) throw new AppError('denied', 'You cannot block yourself', 403);
  return tx(async c => {
    const u = (await c.query('select status from users where id=$1 for update', [userId])).rows[0];
    if (!u) throw new AppError('not_found', 'Person not found', 404);
    if ((await c.query("select 1 from memberships where user_id=$1 and role like 'platform\\_%' and revoked_at is null", [userId])).rowCount) throw new AppError('denied', 'Platform staff are managed from the staff list', 403);
    await c.query("update users set status='disabled', blocked_reason=$2 where id=$1", [userId, why]);
    await c.query('delete from sessions where user_id=$1', [userId]);
    await audit(c, { actor: actor.userId, action: 'user.blocked', type: 'user', id: userId, outcome: 'ok' });
    return { status: 'disabled' };
  });
}
export async function unblockUser(actor: Actor, userId: string, reason: string) {
  need(actor, ['platform_owner']); reasonOf(reason);
  const r = await getPool().query("update users set status='active', blocked_reason=null where id=$1 and status='disabled' and blocked_reason is not null and closed_at is null returning id", [userId]);
  if (!r.rowCount) throw new AppError('invalid_transition', 'This account was not blocked by staff', 409);
  await audit(getPool(), { actor: actor.userId, action: 'user.unblocked', type: 'user', id: userId, outcome: 'ok' });
  return { status: 'active' };
}

/* ---------- platform staff (SC-059): invite, change role, remove. Owner only; the last owner is protected; nobody changes their own role. ---------- */
const platformTenant = async (c: { query: Function }) => (await c.query("select id from tenants where kind='platform' order by created_at limit 1")).rows[0]?.id as string;
export async function listPlatformStaff(actor: Actor) {
  need(actor, ['platform_owner']);
  const pool = getPool(); const pt = await platformTenant(pool);
  const staff = (await pool.query("select m.id, u.email, m.role, m.created_at, u.mfa_enabled_at is not null as mfa, m.user_id from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.revoked_at is null order by m.created_at", [pt])).rows;
  const invites = (await pool.query("select id, invite_email, invite_role, expires_at from auth_tokens where tenant_id=$1 and purpose='invite' and used_at is null and revoked_at is null and expires_at>now() order by created_at", [pt])).rows;
  return { staff: staff.map(s => ({ id: s.id, email: s.email, role: s.role, since: s.created_at, twoStep: s.mfa, me: s.user_id === actor.userId })), invites: invites.map(i => ({ id: i.id, email: i.invite_email, role: i.invite_role, expiresAt: i.expires_at })) };
}
export async function invitePlatformStaff(actor: Actor, email: string, role: string, code?: string) {
  need(actor, ['platform_owner']);
  if (!PLATFORM_ROLES.includes(role)) throw new AppError('invalid_role', 'Choose owner, finance or support');
  const to = String(email ?? '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new AppError('invalid_email', 'Enter a valid email address');
  return tx(async c => {
    await stepUp(c, actor.userId, code);
    const pt = await platformTenant(c);
    if ((await c.query('select 1 from users where lower(email)=$1', [to])).rowCount) throw new AppError('account_exists', 'An account already exists for this email. Platform staff need a separate account that is used for nothing else.', 409);
    await c.query("update auth_tokens set revoked_at=now() where tenant_id=$1 and purpose='invite' and invite_email=$2 and used_at is null and revoked_at is null", [pt, to]);
    const token = randomBytes(32).toString('base64url');
    await c.query("insert into auth_tokens(purpose,token_hash,tenant_id,invite_email,invite_role,invited_by,expires_at) values('invite',$1,$2,$3,$4,$5, now() + interval '7 days')", [createHash('sha256').update(token).digest('hex'), pt, to, role, actor.userId]);
    await c.query("insert into email_outbox(to_email,template,body) values($1,'invite',$2)", [to, JSON.stringify({ token })]);
    await audit(c, { actor: actor.userId, tenant: pt, action: 'platform_staff.invited', outcome: role });
    return { status: 'invited' };
  });
}
export async function revokePlatformInvite(actor: Actor, id: string) {
  need(actor, ['platform_owner']);
  const r = await getPool().query("update auth_tokens set revoked_at=now() where id=$1 and purpose='invite' and used_at is null and revoked_at is null and tenant_id=(select id from tenants where kind='platform' order by created_at limit 1) returning id", [id]);
  if (!r.rowCount) throw new AppError('not_found', 'Invitation not found', 404);
  return { ok: true };
}
export async function changePlatformStaff(actor: Actor, membershipId: string, change: { role?: string; remove?: boolean }, code?: string) {
  need(actor, ['platform_owner']);
  if (change.role && !PLATFORM_ROLES.includes(change.role)) throw new AppError('invalid_role', 'Choose owner, finance or support');
  return tx(async c => {
    const pt = await platformTenant(c);
    const owners = (await c.query("select id, user_id from memberships where tenant_id=$1 and role='platform_owner' and revoked_at is null for update", [pt])).rows;
    if (!owners.some(o => o.user_id === actor.userId)) throw new AppError('denied', 'Not permitted', 403); // checked against the database now, not the role the session started with
    const m = (await c.query('select id, user_id, role from memberships where id=$1 and tenant_id=$2 and revoked_at is null for update', [membershipId, pt])).rows[0];
    if (!m) throw new AppError('not_found', 'Staff member not found', 404);
    if (m.user_id === actor.userId) throw new AppError('self_change', 'You cannot change your own role or remove yourself. Ask another owner.', 403);
    if (m.role === 'platform_owner' && owners.length <= 1) throw new AppError('last_admin', 'The last platform owner cannot be changed or removed', 409);
    await stepUp(c, actor.userId, code);
    if (change.remove) { await c.query('update memberships set revoked_at=now() where id=$1', [membershipId]); await c.query('delete from sessions where user_id=$1', [m.user_id]); }
    else if (change.role && change.role !== m.role) { await c.query('update memberships set role=$2 where id=$1', [membershipId, change.role]); await c.query('delete from sessions where user_id=$1', [m.user_id]); }
    await c.query("insert into email_outbox(to_email,template,body) select email,'role_changed','{}' from users where id=$1", [m.user_id]);
    await audit(c, { actor: actor.userId, tenant: pt, action: change.remove ? 'platform_staff.removed' : 'platform_staff.role_changed', type: 'membership', id: membershipId, outcome: change.role ?? 'removed' });
    return { ok: true };
  });
}

/* ---------- direct store workspace (SC-057): the owner's own channel. Counts and references only; no artwork. ---------- */
export async function directStore(actor: Actor) {
  need(actor, STAFF);
  const pool = getPool();
  const t = (await pool.query("select t.id, t.name, t.status, p.slug from tenants t join vendor_profiles p on p.tenant_id=t.id where t.kind='direct' and t.status<>'closed' limit 1")).rows[0];
  if (!t) return { exists: false as const };
  const price = (await pool.query('select per_mp_paise, min_paise, created_at from vendor_pricing where tenant_id=$1 order by created_at desc, id desc limit 1', [t.id])).rows[0];
  const one = async (sql: string) => Number((await pool.query(sql, [t.id])).rows[0].n);
  const jobs = (await pool.query("select status, count(*)::int n from jobs where tenant_id=$1 and created_at > now() - interval '30 days' group by status", [t.id])).rows;
  const tickets = (await pool.query("select id, reference, subject, status, created_at from tickets where tenant_id=$1 and status not in ('resolved','closed') order by created_at desc limit 20", [t.id])).rows;
  const refunds = (await pool.query("select id, reference, amount_paise, status, created_at from refunds where tenant_id=$1 and status='requested' order by created_at", [t.id])).rows;
  return { exists: true as const, id: t.id, name: t.name, status: t.status, slug: t.slug, price: price ? { perMpPaise: Number(price.per_mp_paise), minPaise: Number(price.min_paise) } : null,
    customers: await one("select count(*)::int n from memberships where tenant_id=$1 and role='customer' and revoked_at is null"), jobs30d: Object.fromEntries(jobs.map(j => [j.status, j.n])),
    openTickets: tickets, refundsWaiting: refunds.map(r => ({ id: r.id, reference: r.reference, amountPaise: Number(r.amount_paise), createdAt: r.created_at })), canEdit: actor.role === 'platform_owner' };
}
export async function setDirectPrice(actor: Actor, perMpPaise: number, minPaise: number) {
  need(actor, ['platform_owner']);
  if (!Number.isInteger(perMpPaise) || !Number.isInteger(minPaise) || perMpPaise < 0 || minPaise < 0) throw new AppError('invalid_amount', 'Prices must be zero or more');
  const t = (await getPool().query("select id from tenants where kind='direct' and status<>'closed' limit 1")).rows[0];
  if (!t) throw new AppError('not_found', 'Create the direct store first', 404);
  await getPool().query('insert into vendor_pricing(tenant_id,per_mp_paise,min_paise,created_by) values($1,$2,$3,$4)', [t.id, perMpPaise, minPaise, actor.userId]);
  await audit(getPool(), { actor: actor.userId, tenant: t.id, action: 'pricing.retail', outcome: 'ok' });
  return { ok: true };
}

/* ---------- configuration (SC-073): what is switched on. Secrets are set in the hosting environment and are never shown or edited here. ---------- */
export async function configStatus(actor: Actor) {
  need(actor, ANY_PLATFORM);
  const e = process.env; const pool = getPool();
  const emailDriver = e.EMAIL_DRIVER || null;
  const outbox = (await pool.query("select count(*) filter (where status='pending')::int waiting, count(*) filter (where status='failed')::int failed from email_outbox")).rows[0];
  return {
    role: actor.role,
    environment: e.APP_ENV ?? 'development',
    payments: { ...providerStatus(), settlement: manualSettlement() ? 'manual (bank transfers recorded by hand)' : 'automated through the provider' },
    email: { driver: emailDriver, from: e.EMAIL_FROM || null, sending: !!emailDriver && !!e.EMAIL_FROM, waiting: outbox.waiting as number, failed: outbox.failed as number },
    storage: { driver: e.STORAGE_DRIVER ?? 'local', bucket: e.S3_BUCKET ? 'set' : null },
    security: { twoStepKey: !!e.MFA_ENC_KEY, downloadLinkSecret: !!e.DOWNLOAD_LINK_SECRET, twoStepRequiredRoles: (e.MFA_REQUIRED_ROLES ?? 'platform_owner,platform_support,platform_finance').split(',').filter(Boolean) },
    limits: { uploadMb: 25, uploadMegapixels: 40, outputMegapixels: 80, maxSideMm: 500, quoteMinutes: 15, holdExpiryMinutes: Number(e.HOLD_EXPIRY_MINUTES ?? 30), retentionDays: 90, downloadLinkMinutes: 5, topUpMinRupees: 100, topUpMaxRupees: 10000 },
    schedule: [
      { task: 'hold_expiry', every: '5 minutes' }, { task: 'payment_reconcile', every: '5 minutes' }, { task: 'subscription_lifecycle', every: 'hour' }, { task: 'retention', every: 'hour' },
      { task: 'account_maintenance', every: 'hour' }, { task: 'closed_store_purge', every: 'hour' }, { task: 'refund_reconcile', every: 'hour' }, { task: 'transfer_reconcile', every: 'hour' },
    ],
    canSendTest: actor.role === 'platform_owner',
  };
}
/** Sends one test message, only to the signed-in owner's own address. */
export async function sendTestEmail(actor: Actor) {
  need(actor, ['platform_owner']);
  await getPool().query("insert into email_outbox(to_email,template,body) select email,'test_message','{}' from users where id=$1", [actor.userId]);
  await audit(getPool(), { actor: actor.userId, action: 'config.test_email', outcome: 'queued' });
  return { status: 'queued' };
}

/* ---------- incident and recovery register (SC-074, WF-24). A record of what was done; the restore itself follows the runbook, never a button here. ---------- */
const FLOW: Record<string, string[]> = { open: ['contained', 'closed'], contained: ['restored', 'reconciled', 'closed'], restored: ['reconciled'], reconciled: ['reopened'], reopened: ['closed'], closed: [] };
export async function listIncidents(actor: Actor) {
  need(actor, ANY_PLATFORM);
  const pool = getPool();
  const rows = (await pool.query('select i.*, u.email as recorder, a.email as approver from incidents i join users u on u.id=i.recorded_by left join users a on a.id=i.reopen_approved_by order by (i.status=\'closed\'), i.created_at desc limit 100')).rows;
  const out = [];
  for (const i of rows) out.push({ id: i.id, reference: i.reference, title: i.title, severity: i.severity, scope: i.scope, backupRef: i.backup_ref, containment: i.containment, status: i.status, evidence: i.evidence, recorder: i.recorder, approver: i.approver, createdAt: i.created_at, next: FLOW[i.status],
    notes: (await pool.query('select n.status, n.note, n.created_at, u.email from incident_notes n join users u on u.id=n.author where n.incident_id=$1 order by n.id', [i.id])).rows });
  return { incidents: out, canApproveReopen: actor.role === 'platform_owner' };
}
export async function recordIncident(actor: Actor, p: { title: string; severity: string; scope: string }) {
  need(actor, ANY_PLATFORM);
  const title = String(p.title ?? '').trim(), scope = String(p.scope ?? '').trim();
  if (title.length < 5 || title.length > 160) throw new AppError('invalid_title', 'Give the incident a short title');
  if (!['critical', 'major', 'minor'].includes(p.severity)) throw new AppError('invalid_severity', 'Choose a severity');
  if (scope.length < 10) throw new AppError('invalid_scope', 'Describe what is affected');
  const r = (await getPool().query('insert into incidents(title,severity,scope,recorded_by) values($1,$2,$3,$4) returning id, reference', [title, p.severity, scope.slice(0, 2000), actor.userId])).rows[0];
  await audit(getPool(), { actor: actor.userId, action: 'incident.recorded', type: 'incident', id: r.id, outcome: p.severity });
  return { id: r.id as string, reference: r.reference as string };
}
/** Moves an incident one step. "Reopened" (business back in service) needs the owner, a statement that provider events since the backup were reconciled, and evidence. */
export async function advanceIncident(actor: Actor, id: string, p: { to: string; note: string; backupRef?: string; evidence?: string; code?: string }) {
  need(actor, ANY_PLATFORM);
  const note = reasonOf(p.note);
  return tx(async c => {
    const i = (await c.query('select * from incidents where id=$1 for update', [id])).rows[0];
    if (!i) throw new AppError('not_found', 'Incident not found', 404);
    if (!FLOW[i.status]?.includes(p.to)) throw new AppError('invalid_transition', `An incident that is ${i.status} cannot move to ${p.to}`, 409);
    if (p.to === 'restored' && !String(p.backupRef ?? '').trim()) throw new AppError('backup_required', 'Record which backup was restored');
    if (p.to === 'reopened') {
      if (actor.role !== 'platform_owner') throw new AppError('denied', 'Only the platform owner approves reopening', 403);
      if (String(p.evidence ?? '').trim().length < 3) throw new AppError('evidence_required', 'Record the evidence for reopening (test results, reconciliation reference)');
      await stepUp(c, actor.userId, p.code);
      await c.query('update incidents set reopen_approved_by=$2, reopen_approved_at=now(), evidence=$3 where id=$1', [id, actor.userId, String(p.evidence).trim().slice(0, 1000)]);
    }
    await c.query('update incidents set status=$2, backup_ref=coalesce($3,backup_ref), containment=case when $2=\'contained\' then $4 else containment end, updated_at=now() where id=$1', [id, p.to, String(p.backupRef ?? '').trim().slice(0, 200) || null, note]);
    await c.query('insert into incident_notes(incident_id,author,status,note) values($1,$2,$3,$4)', [id, actor.userId, p.to, note]);
    await audit(c, { actor: actor.userId, action: 'incident.' + p.to, type: 'incident', id, outcome: 'ok' });
    return { status: p.to };
  });
}
