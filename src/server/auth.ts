import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { getPool, AppError } from './db';

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
const sha = (t: string) => createHash('sha256').update(t).digest('hex');

export async function createUser(email: string, password: string, tenantId: string, role: string) {
  if (password.length < 12) throw new AppError('weak_password', 'Password must be at least 12 characters');
  const p = getPool();
  const u = await p.query('insert into users(email,password_hash) values($1,$2) returning id', [email.trim(), hashPassword(password)])
    .catch(e => { if (e.code === '23505') throw new AppError('email_taken', 'Email already registered', 409); throw e; });
  await p.query('insert into memberships(tenant_id,user_id,role) values($1,$2,$3)', [tenantId, u.rows[0].id, role]);
  return u.rows[0].id as string;
}

export async function login(email: string, password: string) {
  const p = getPool();
  const r = await p.query("select id,password_hash from users where lower(email)=lower($1) and status='active'", [email.trim()]);
  const ok = r.rowCount ? verifyPassword(password, r.rows[0].password_hash) : (verifyPassword(password, 'scrypt$00$00'), false);
  if (!ok) throw new AppError('invalid_credentials', 'Email or password is incorrect', 401);
  const token = randomBytes(32).toString('base64url');
  const ttl = Number(process.env.SESSION_TTL_HOURS ?? 12);
  await p.query("insert into sessions(token_hash,user_id,expires_at) values($1,$2, now() + ($3 || ' hours')::interval)", [sha(token), r.rows[0].id, String(ttl)]);
  return { token, userId: r.rows[0].id as string };
}

export type Actor = { userId: string; tenantId: string; role: string };

/** Resolves the session AND the tenant context from an active membership. Tenant is never taken from client claims alone:
 *  the requested tenant must match an unrevoked membership of this user. */
export async function resolveActor(token: string | undefined, requestedTenantId: string | undefined): Promise<Actor> {
  if (!token) throw new AppError('unauthenticated', 'Sign in required', 401);
  const p = getPool();
  const s = await p.query('select user_id from sessions where token_hash=$1 and expires_at>now()', [sha(token)]);
  if (!s.rowCount) throw new AppError('session_expired', 'Session expired', 401);
  const m = await p.query(
    `select tenant_id, role from memberships m join tenants t on t.id=m.tenant_id
     where m.user_id=$1 and m.revoked_at is null and t.status='active' and ($2::uuid is null or m.tenant_id=$2::uuid)
     order by m.created_at limit 2`, [s.rows[0].user_id, requestedTenantId ?? null]);
  if (!m.rowCount) throw new AppError('denied', 'No access to this workspace', 403);
  if (!requestedTenantId && m.rowCount > 1) throw new AppError('tenant_required', 'Choose a workspace', 400);
  return { userId: s.rows[0].user_id, tenantId: m.rows[0].tenant_id, role: m.rows[0].role };
}
export async function logout(token: string) { await getPool().query('delete from sessions where token_hash=$1', [sha(token)]); }
