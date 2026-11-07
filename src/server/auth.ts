import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { getPool, tx, AppError } from './db';
import { sha, issueSession } from './sessions';
import { keys, lockKey, assertNotLocked, recordFailure, auditLockoutCrossing, createChallenge, userRequiresMfa } from './mfa';

export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const h = scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string): boolean {
  const [alg, s, h] = stored.split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  const calc = scryptSync(pw, Buffer.from(s, 'hex'), 64);
  const want = Buffer.from(h, 'hex');
  return calc.length === want.length && timingSafeEqual(calc, want);
}

export async function createUser(email: string, password: string, tenantId: string, role: string) {
  if (password.length < 12) throw new AppError('weak_password', 'Password must be at least 12 characters');
  const p = getPool();
  const u = await p.query('insert into users(email,password_hash,email_verified_at) values($1,$2,now()) returning id', [email.trim(), hashPassword(password)])
    .catch(e => { if (e.code === '23505') throw new AppError('email_taken', 'Email already registered', 409); throw e; });
  await p.query('insert into memberships(tenant_id,user_id,role) values($1,$2,$3)', [tenantId, u.rows[0].id, role]);
  return u.rows[0].id as string;
}

/** Password step. Failed attempts are counted per email and per source (the same answer whether or not the account exists), and a locked
 *  email gets no password check at all. If the user has two-step sign-in on, only a short-lived challenge is returned, never a session. */
export async function login(email: string, password: string, source = 'unknown'): Promise<{ token?: string; challenge?: string; enrolOnly?: boolean; userId: string }> {
  const k = keys(email, source);
  const out = await tx(async c => {
    await lockKey(c, k); await assertNotLocked(c, k);
    const r = await c.query("select id,password_hash,mfa_enabled_at from users where lower(email)=lower($1) and status='active' and email_verified_at is not null", [email.trim()]);
    const ok = r.rowCount ? verifyPassword(password, r.rows[0].password_hash) : (verifyPassword(password, 'scrypt$00$00'), false);
    if (!ok) { await recordFailure(c, k); await c.query("insert into audit_log(actor_user_id,action,object_type,outcome) values($1,'auth.password_failed','user','denied')", [r.rowCount ? r.rows[0].id : null]); await auditLockoutCrossing(c, k, r.rowCount ? r.rows[0].id : null); return null; } // the attempted email is not stored // commit the failure, reject below
    const u = r.rows[0];
    // With two-step on, a correct password must NOT clear the count: otherwise a stolen password could farm unlimited code guesses.
    if (u.mfa_enabled_at) return { userId: u.id as string, challenge: await createChallenge(c, u.id), enrolOnly: false, needsSession: false };
    await c.query('delete from login_failures where email_key=$1', [k.email]);
    return { userId: u.id as string, challenge: undefined, enrolOnly: await userRequiresMfa(c, u.id), needsSession: true };
  });
  if (!out) throw new AppError('invalid_credentials', 'Email or password is incorrect', 401);
  if (out.challenge) return { challenge: out.challenge, userId: out.userId };
  return { token: await issueSession(out.userId, out.enrolOnly), enrolOnly: out.enrolOnly, userId: out.userId };
}

export type Actor = { userId: string; tenantId: string; role: string };

/** Resolves the session AND the tenant context from an active membership. Tenant is never taken from client claims alone:
 *  the requested tenant must match an unrevoked membership of this user. */
export async function resolveActor(token: string | undefined, requestedTenantId: string | undefined, opts: { allowEnrolOnly?: boolean } = {}): Promise<Actor> {
  if (!token) throw new AppError('unauthenticated', 'Sign in required', 401);
  const p = getPool();
  const s = await p.query('select s.user_id, (s.enrol_only and u.mfa_enabled_at is null) as enrol_only from sessions s join users u on u.id=s.user_id where s.token_hash=$1 and s.expires_at>now() and u.status=\'active\'', [sha(token)]);
  if (!s.rowCount) throw new AppError('session_expired', 'Session expired', 401);
  if (s.rows[0].enrol_only && !opts.allowEnrolOnly) throw new AppError('mfa_enrolment_required', 'Set up two-step sign-in to continue', 403);
  const m = await p.query(
    `select tenant_id, role from memberships m join tenants t on t.id=m.tenant_id
     where m.user_id=$1 and m.revoked_at is null and t.status in ('active','closing') and ($2::uuid is null or m.tenant_id=$2::uuid)
     order by m.created_at limit 2`, [s.rows[0].user_id, requestedTenantId ?? null]);
  if (!m.rowCount) throw new AppError('denied', 'No access to this workspace', 403);
  if (!requestedTenantId && m.rowCount > 1) throw new AppError('tenant_required', 'Choose a workspace', 400);
  return { userId: s.rows[0].user_id, tenantId: m.rows[0].tenant_id, role: m.rows[0].role };
}
export async function logout(token: string) {
  const r = await getPool().query('delete from sessions where token_hash=$1 returning user_id', [sha(token)]);
  if (r.rowCount) await getPool().query("insert into audit_log(actor_user_id,action,object_type,outcome) values($1,'auth.logout','session','ok')", [r.rows[0].user_id]);
}
