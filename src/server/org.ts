import type pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { audit } from './identity';
import { balance } from './ledger';
import { csvRow } from '../lib/csv';

type Q = { query: pg.Pool['query'] };
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
export const MAX_MEMBERS = 9; // plus one administrator
export const MONTH_START = "date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'";

async function activeMembership(c: Q, orgId: string, userId: string) {
  const r = await c.query(`select m.id, m.role, m.monthly_limit_paise, o.tenant_id from org_members m join organisations o on o.id=m.org_id where m.org_id=$1 and m.user_id=$2 and m.revoked_at is null and o.status='active'`, [orgId, userId]);
  return r.rows[0] as { id: string; role: string; monthly_limit_paise: string | null; tenant_id: string } | undefined;
}
/** The caller must be an active member of this organisation inside their own tenant; admins need role 'admin'. Unknown/foreign orgs look like not-found. */
async function requireOrg(c: Q, actor: Actor, orgId: string, admin: boolean) {
  const m = await activeMembership(c, orgId, actor.userId);
  if (!m || m.tenant_id !== actor.tenantId || actor.role !== 'customer') throw new AppError('not_found', 'Organisation not found', 404);
  if (admin && m.role !== 'admin') throw new AppError('denied', 'Only the organisation administrator can do this', 403);
  return m;
}
export async function myOrganisations(actor: Actor) {
  const r = await getPool().query(`select o.id, o.name, m.role from org_members m join organisations o on o.id=m.org_id where m.user_id=$1 and m.revoked_at is null and o.status='active' and o.tenant_id=$2`, [actor.userId, actor.tenantId]);
  return r.rows as { id: string; name: string; role: string }[];
}

export async function createOrganisation(actor: Actor, name: string, billingContact?: string) {
  if (actor.role !== 'customer') throw new AppError('denied', 'Only customers can create an organisation', 403);
  if (!name.trim()) throw new AppError('invalid_name', 'Organisation name is required');
  return tx(async c => {
    const ex = await c.query(`select 1 from org_members m join organisations o on o.id=m.org_id where m.user_id=$1 and m.revoked_at is null and o.tenant_id=$2 and o.status='active' and m.role='admin'`, [actor.userId, actor.tenantId]);
    if (ex.rowCount) throw new AppError('exists', 'You already administer an organisation in this store', 409);
    const o = await c.query('insert into organisations(tenant_id,name,billing_contact,created_by) values($1,$2,$3,$4) returning id', [actor.tenantId, name.trim().slice(0, 120), billingContact?.trim() || null, actor.userId]);
    await c.query("insert into org_members(org_id,user_id,role) values($1,$2,'admin')", [o.rows[0].id, actor.userId]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'org.create', type: 'org', id: o.rows[0].id, outcome: 'ok' });
    return { id: o.rows[0].id as string };
  });
}
export async function updateProfile(actor: Actor, orgId: string, p: { name?: string; billingContact?: string | null }) {
  await requireOrg(getPool(), actor, orgId, true);
  if (p.name !== undefined && !p.name.trim()) throw new AppError('invalid_name', 'Organisation name is required');
  await getPool().query('update organisations set name=coalesce($2,name), billing_contact=case when $3::boolean then $4 else billing_contact end where id=$1', [orgId, p.name?.trim() ?? null, p.billingContact !== undefined, p.billingContact ?? null]);
}

/* ---------- members ---------- */
async function seatCount(c: Q, orgId: string) {
  const m = (await c.query('select count(*)::int n from org_members where org_id=$1 and revoked_at is null', [orgId])).rows[0].n;
  const i = (await c.query('select count(*)::int n from org_invites where org_id=$1 and used_at is null and revoked_at is null and expires_at>now()', [orgId])).rows[0].n;
  return { members: m as number, pending: i as number }; // total includes the administrator
}
export async function inviteMember(actor: Actor, orgId: string, email: string) {
  return tx(async c => {
    await requireOrg(c, actor, orgId, true);
    await c.query('select 1 from organisations where id=$1 for update', [orgId]); // serialise seat counting
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) throw new AppError('invalid_email', 'Enter a valid email address');
    const s = await seatCount(c, orgId);
    if (s.members + s.pending >= MAX_MEMBERS + 1) throw new AppError('no_seats', 'An organisation can have one administrator and up to nine members', 409);
    const token = randomBytes(32).toString('base64url');
    await c.query("insert into org_invites(org_id,email,token_hash,invited_by,expires_at) values($1,lower($2),$3,$4, now() + interval '7 days')", [orgId, email.trim(), sha(token), actor.userId]);
    await c.query("insert into email_outbox(to_email,template,body) values($1,'org_invite',$2)", [email.trim(), JSON.stringify({ token })]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'org.invite', type: 'org', id: orgId, outcome: 'ok' });
  });
}
/** Acceptance needs a signed-in customer of the same store whose own email matches the invite: an invite never creates or takes over an account. */
export async function acceptInvite(actor: Actor, token: string) {
  return tx(async c => {
    const r = await c.query('select i.*, o.tenant_id, o.status from org_invites i join organisations o on o.id=i.org_id where i.token_hash=$1 for update of i', [sha(token)]);
    const i = r.rows[0];
    const bad = () => new AppError('invalid_token', 'This invitation is invalid, expired or already used', 400);
    if (!i || i.used_at || i.revoked_at || new Date(i.expires_at) <= new Date() || i.status !== 'active') throw bad();
    const u = await c.query('select email from users where id=$1', [actor.userId]);
    if (i.tenant_id !== actor.tenantId || actor.role !== 'customer' || u.rows[0].email.toLowerCase() !== i.email) throw bad(); // same message: no probing
    await c.query('select 1 from organisations where id=$1 for update', [i.org_id]);
    if ((await seatCount(c, i.org_id)).members >= MAX_MEMBERS + 1) throw new AppError('no_seats', 'This organisation is full', 409);
    if (await activeMembership(c, i.org_id, actor.userId)) throw new AppError('already_member', 'You are already a member', 409);
    await c.query('update org_invites set used_at=now() where id=$1', [i.id]);
    await c.query("insert into org_members(org_id,user_id,role) values($1,$2,'member')", [i.org_id, actor.userId]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'org.join', type: 'org', id: i.org_id, outcome: 'ok' });
    return { orgId: i.org_id as string };
  });
}
export async function revokeMember(actor: Actor, orgId: string, memberId: string) {
  return tx(async c => {
    await requireOrg(c, actor, orgId, true);
    const m = await c.query('select id, role, user_id from org_members where id=$1 and org_id=$2 and revoked_at is null for update', [memberId, orgId]);
    if (!m.rowCount) throw new AppError('not_found', 'Member not found', 404);
    if (m.rows[0].role === 'admin') throw new AppError('last_admin', 'The administrator cannot be removed. Transfer the role to another member first.', 409);
    await c.query('update org_members set revoked_at=now() where id=$1', [memberId]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'org.revoke', type: 'org_member', id: memberId, outcome: 'ok' });
  });
}
/** Atomic swap so the organisation is never without (or with two) administrators. */
export async function transferAdmin(actor: Actor, orgId: string, newAdminMemberId: string) {
  return tx(async c => {
    const me = await requireOrg(c, actor, orgId, true);
    const t = await c.query("select id from org_members where id=$1 and org_id=$2 and revoked_at is null and role='member' for update", [newAdminMemberId, orgId]);
    if (!t.rowCount) throw new AppError('not_found', 'Member not found', 404);
    await c.query("update org_members set role='member' where id=$1", [me.id]);
    await c.query("update org_members set role='admin', monthly_limit_paise=null where id=$1", [newAdminMemberId]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'org.transfer_admin', type: 'org', id: orgId, outcome: 'ok' });
  });
}
export async function setMemberLimit(actor: Actor, orgId: string, memberId: string, limitPaise: number | null) {
  if (limitPaise !== null && (!Number.isInteger(limitPaise) || limitPaise < 0)) throw new AppError('invalid_limit', 'Limit must be a whole number of paise');
  return tx(async c => {
    await requireOrg(c, actor, orgId, true);
    const m = await c.query("select id, role from org_members where id=$1 and org_id=$2 and revoked_at is null for update", [memberId, orgId]);
    if (!m.rowCount) throw new AppError('not_found', 'Member not found', 404);
    if (m.rows[0].role === 'admin') throw new AppError('invalid_target', 'The administrator has no spending ceiling', 400);
    await c.query('update org_members set monthly_limit_paise=$2 where id=$1', [memberId, limitPaise]); // lowering below usage is allowed: it only blocks new spending
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'org.limit', type: 'org_member', id: memberId, outcome: 'ok' });
  });
}
/** Used = consumed + still-held reservations created this month (IST) by this member. Released reservations restore capacity. */
export async function monthUsage(c: Q, orgId: string, userId: string) {
  const r = await c.query(`select coalesce(sum(case when status='consumed' then customer_paise end),0)::bigint spent, coalesce(sum(case when status='held' then customer_paise end),0)::bigint reserved
    from reservations where org_id=$1 and spender_user_id=$2 and status in ('held','consumed') and created_at >= ${MONTH_START}`, [orgId, userId]);
  return { spent: Number(r.rows[0].spent), reserved: Number(r.rows[0].reserved) };
}
export async function listMembers(actor: Actor, orgId: string) {
  await requireOrg(getPool(), actor, orgId, true);
  const r = await getPool().query(`select m.id, u.email, m.role, m.monthly_limit_paise, m.user_id from org_members m join users u on u.id=m.user_id where m.org_id=$1 and m.revoked_at is null order by m.role, u.email`, [orgId]);
  const out = [];
  for (const m of r.rows) { const u = await monthUsage(getPool(), orgId, m.user_id); out.push({ id: m.id, email: m.email, role: m.role, monthlyLimitPaise: m.monthly_limit_paise === null ? null : Number(m.monthly_limit_paise), spentPaise: u.spent, reservedPaise: u.reserved }); }
  const seats = await seatCount(getPool(), orgId);
  return { members: out, seats: { used: seats.members + seats.pending, limit: MAX_MEMBERS + 1 } };
}
export async function orgBalance(actor: Actor, orgId: string) {
  await requireOrg(getPool(), actor, orgId, true);
  const a = await getPool().query("select id from ledger_accounts where org_id=$1 and kind='organisation_service_credit'", [orgId]);
  return a.rowCount ? balance(a.rows[0].id) : { settled: 0, held: 0, available: 0 };
}

/* ---------- project sharing and read access ---------- */
export async function setVisibility(actor: Actor, projectId: string, visibility: 'private' | 'shared') {
  if (!['private', 'shared'].includes(visibility)) throw new AppError('invalid_visibility', 'Choose private or shared');
  const r = await getPool().query('select owner_user_id, tenant_id, org_id from projects where id=$1', [projectId]);
  const p = r.rows[0];
  if (!p || p.owner_user_id !== actor.userId || p.tenant_id !== actor.tenantId) throw new AppError('not_found', 'Project not found', 404);
  if (!p.org_id) throw new AppError('not_organisation', 'Only organisation projects can be shared', 400);
  if (!(await activeMembership(getPool(), p.org_id, actor.userId))) throw new AppError('not_found', 'Project not found', 404);
  await getPool().query('update projects set visibility=$2 where id=$1', [projectId, visibility]);
  await audit(getPool(), { actor: actor.userId, tenant: actor.tenantId, action: 'project.visibility', type: 'project', id: projectId, outcome: visibility });
}
/** Owner (still a member, for organisation projects) or an active member of the organisation when the project is shared. The organisation admin gets NO extra access to private artwork. */
export async function canReadProject(c: Q, actor: Actor, p: { tenant_id: string; owner_user_id: string; org_id: string | null; visibility: string }) {
  if (p.tenant_id !== actor.tenantId || actor.role !== 'customer' && actor.role !== 'vendor_counter') return false;
  if (!p.org_id) return p.owner_user_id === actor.userId;
  const m = await activeMembership(c, p.org_id, actor.userId);
  if (!m || m.tenant_id !== actor.tenantId) return false;
  return p.owner_user_id === actor.userId || p.visibility === 'shared';
}

/* ---------- usage report ---------- */
export async function usageReport(actor: Actor, orgId: string, f: { from?: string; to?: string; memberId?: string } = {}) {
  await requireOrg(getPool(), actor, orgId, true);
  const rows = await getPool().query(`
    select r.created_at as date, u.email as member, p.name as project, r.customer_paise as amount_paise, r.status
    from reservations r join users u on u.id=r.spender_user_id join quotes q on q.id=r.quote_id join projects p on p.id=q.project_id
    left join org_members m on m.org_id=r.org_id and m.user_id=r.spender_user_id and m.revoked_at is null
    where r.org_id=$1 and r.status in ('held','consumed')
      and ($2::timestamptz is null or r.created_at >= $2) and ($3::timestamptz is null or r.created_at < $3) and ($4::uuid is null or m.id = $4)
    order by r.created_at desc limit 5000`, [orgId, f.from ?? null, f.to ?? null, f.memberId ?? null]);
  return { balance: await orgBalance(actor, orgId), rows: rows.rows.map(r => ({ date: new Date(r.date).toISOString(), member: r.member as string, project: r.project as string, amountPaise: Number(r.amount_paise), status: r.status as string })) };
}
export async function usageCsv(actor: Actor, orgId: string, f: { from?: string; to?: string; memberId?: string } = {}) {
  const r = await usageReport(actor, orgId, f);
  const lines = [csvRow(['Date', 'Member', 'Project', 'Amount (INR)', 'Status'])];
  for (const x of r.rows) lines.push(csvRow([x.date, x.member, x.project, (x.amountPaise / 100).toFixed(2), x.status === 'held' ? 'reserved' : 'spent']));
  await audit(getPool(), { actor: actor.userId, tenant: actor.tenantId, action: 'org.export', type: 'org', id: orgId, outcome: `${r.rows.length} rows` });
  return lines.join('\r\n') + '\r\n';
}
