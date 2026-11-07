import { randomBytes, createHash } from 'node:crypto';
import type pg from 'pg';
import { getPool, tx, AppError } from './db';
import { hashPassword } from './auth';
import type { Actor } from './auth';
import { seatsInfo } from './vendor';

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const ADMIN_ROLES = ['vendor_admin', 'platform_owner'];
const INVITABLE = ['vendor_counter', 'vendor_support', 'vendor_finance', 'vendor_admin'];

export async function audit(c: { query: pg.Pool['query'] }, a: { actor?: string | null; tenant?: string | null; action: string; type?: string; id?: string; outcome: string }) {
  await c.query('insert into audit_log(actor_user_id,tenant_id,action,object_type,object_id,outcome) values($1,$2,$3,$4,$5,$6)', [a.actor ?? null, a.tenant ?? null, a.action, a.type ?? null, a.id ?? null, a.outcome]);
}
function checkPassword(pw: string) { if (pw.length < 12) throw new AppError('weak_password', 'Password must be at least 12 characters'); }

/** Raw token only ever goes into the outbox email body, never logged or returned to the browser. */
async function queueEmail(c: { query: pg.Pool['query'] }, to: string, template: string, token: string) {
  await c.query('insert into email_outbox(to_email,template,body) values($1,$2,$3)', [to, template, JSON.stringify({ token })]);
}

export async function register(email: string, password: string, tenantId: string) {
  checkPassword(password);
  return tx(async c => {
    const t = await c.query("select kind from tenants where id=$1 and status='active'", [tenantId]);
    if (!t.rowCount) throw new AppError('not_found', 'Workspace not found', 404);
    const existing = await c.query('select id from users where lower(email)=lower($1)', [email.trim()]);
    // Same response whether or not the email exists: no account enumeration; existing owners are not reactivated by re-registering.
    if (existing.rowCount) { await audit(c, { action: 'register.duplicate', tenant: tenantId, outcome: 'ignored' }); return { status: 'verification_sent' as const }; }
    const u = await c.query('insert into users(email,password_hash) values($1,$2) returning id', [email.trim(), hashPassword(password)]);
    await c.query("insert into memberships(tenant_id,user_id,role) values($1,$2,'customer')", [tenantId, u.rows[0].id]);
    const token = newToken();
    await c.query("insert into auth_tokens(purpose,token_hash,user_id,tenant_id,expires_at) values('verify_email',$1,$2,$3, now() + interval '24 hours')", [sha(token), u.rows[0].id, tenantId]);
    await queueEmail(c, email.trim(), 'verify_email', token);
    await audit(c, { actor: u.rows[0].id, tenant: tenantId, action: 'register', outcome: 'ok' });
    return { status: 'verification_sent' as const };
  });
}

async function consume(c: pg.PoolClient, purpose: string, token: string) {
  const r = await c.query('select * from auth_tokens where token_hash=$1 and purpose=$2 for update', [sha(token), purpose]);
  const t = r.rows[0];
  if (!t || t.used_at || t.revoked_at || new Date(t.expires_at) <= new Date()) throw new AppError('invalid_token', 'This link is invalid, expired or already used', 400);
  await c.query('update auth_tokens set used_at=now() where id=$1', [t.id]);
  return t;
}

export async function verifyEmail(token: string) {
  return tx(async c => { const t = await consume(c, 'verify_email', token);
    await c.query('update users set email_verified_at=now() where id=$1 and email_verified_at is null', [t.user_id]);
    await audit(c, { actor: t.user_id, action: 'verify_email', outcome: 'ok' }); });
}

export async function requestReset(email: string) {
  return tx(async c => {
    const u = await c.query("select id from users where lower(email)=lower($1) and status='active'", [email.trim()]);
    if (u.rowCount) {
      await c.query("update auth_tokens set revoked_at=now() where user_id=$1 and purpose='reset_password' and used_at is null and revoked_at is null", [u.rows[0].id]);
      const token = newToken();
      await c.query("insert into auth_tokens(purpose,token_hash,user_id,expires_at) values('reset_password',$1,$2, now() + interval '1 hour')", [sha(token), u.rows[0].id]);
      await queueEmail(c, email.trim(), 'reset_password', token);
    }
    return { status: 'sent_if_account_exists' as const }; // identical either way
  });
}

export async function resetPassword(token: string, newPassword: string) {
  checkPassword(newPassword);
  return tx(async c => { const t = await consume(c, 'reset_password', token);
    await c.query('update users set password_hash=$2 where id=$1', [t.user_id, hashPassword(newPassword)]);
    await c.query('delete from sessions where user_id=$1', [t.user_id]); // existing sessions end
    await audit(c, { actor: t.user_id, action: 'reset_password', outcome: 'ok' }); });
}

export async function invite(actor: Actor, email: string, role: string) {
  if (!ADMIN_ROLES.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  if (!INVITABLE.includes(role)) throw new AppError('invalid_role', 'Role cannot be invited');
  return tx(async c => {
    const seats = await seatsInfo(c, actor.tenantId);
    const pending = (await c.query("select count(*)::int n from auth_tokens where tenant_id=$1 and purpose='invite' and used_at is null and revoked_at is null and expires_at>now()", [actor.tenantId])).rows[0].n;
    if (seats.used + pending >= seats.limit) throw new AppError('no_seats', 'Your plan has no free staff seats. Remove a member, wait for an invitation to expire, or change plan at renewal.', 409);
    const token = newToken();
    await c.query("insert into auth_tokens(purpose,token_hash,tenant_id,invite_email,invite_role,invited_by,expires_at) values('invite',$1,$2,lower($3),$4,$5, now() + interval '7 days')", [sha(token), actor.tenantId, email.trim(), role, actor.userId]);
    await queueEmail(c, email.trim(), 'invite', token);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'invite.create', outcome: 'ok' });
    return { status: 'invited' as const };
  });
}

export async function acceptInvite(token: string, password: string) {
  checkPassword(password);
  return tx(async c => {
    const t = await consume(c, 'invite', token);
    const tn = await c.query("select 1 from tenants where id=$1 and status='active'", [t.tenant_id]);
    if (!tn.rowCount) throw new AppError('invalid_token', 'This invitation is no longer valid');
    let uid: string;
    const seats = await seatsInfo(c, t.tenant_id);
    if (seats.used >= seats.limit) throw new AppError('no_seats', 'No staff seat is free any more. Ask the administrator.', 409); // rechecked at acceptance
    const ex = await c.query('select id from users where lower(email)=$1', [t.invite_email]);
    if (ex.rowCount) throw new AppError('account_exists', 'An account already exists for this email. Sign in, then ask the admin to add you.', 409); // never take over an existing account
    const u = await c.query('insert into users(email,password_hash,email_verified_at) values($1,$2,now()) returning id', [t.invite_email, hashPassword(password)]);
    uid = u.rows[0].id; // holding the invite email proves ownership of the address
    await c.query('insert into memberships(tenant_id,user_id,role) values($1,$2,$3)', [t.tenant_id, uid, t.invite_role]);
    await audit(c, { actor: uid, tenant: t.tenant_id, action: 'invite.accept', outcome: 'ok' });
    return { userId: uid };
  });
}

/** Revocation never leaves a tenant without an active admin. Row-locks admins so two simultaneous revokes cannot both pass. */
export async function revokeMembership(actor: Actor, membershipId: string) {
  if (!ADMIN_ROLES.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  return tx(async c => {
    const m = await c.query('select id,tenant_id,role,user_id from memberships where id=$1 and revoked_at is null', [membershipId]);
    if (!m.rowCount || m.rows[0].tenant_id !== actor.tenantId) throw new AppError('not_found', 'Member not found', 404);
    if (ADMIN_ROLES.includes(m.rows[0].role)) {
      const admins = await c.query("select id from memberships where tenant_id=$1 and role = any($2) and revoked_at is null for update", [actor.tenantId, ADMIN_ROLES]);
      if (admins.rowCount! <= 1) throw new AppError('last_admin', 'The last administrator cannot be removed. Add another administrator first.', 409);
    }
    await c.query('update memberships set revoked_at=now() where id=$1', [membershipId]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'membership.revoke', type: 'membership', id: membershipId, outcome: 'ok' });
  });
}
export { getPool };
