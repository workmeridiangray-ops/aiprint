import { createHmac, createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { sha, issueSession } from './sessions';

export const LIMITS = { emailFailures: 5, sourceFailures: 30, windowMinutes: 15, challengeMinutes: 5, challengeAttempts: 5, recoveryCodes: 10 };
export const requiredRoles = () => (process.env.MFA_REQUIRED_ROLES ?? 'platform_owner,platform_support,platform_finance').split(',').map(s => s.trim()).filter(Boolean);
const ISSUER = 'Artwork';

/* ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(buf: Buffer) { let bits = 0, v = 0, out = ''; for (const b of buf) { v = (v << 8) | b; bits += 8; while (bits >= 5) { out += B32[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(v << (5 - bits)) & 31]; return out; }
export function hotp(key: Buffer, counter: number) {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(counter)); const h = createHmac('sha1', key).update(b).digest(); const o = h[19] & 15;
  return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1_000_000).padStart(6, '0');
}
const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** Returns the matching time step (within ±1 step of clock drift) or null. */
export function matchTotp(key: Buffer, code: string, nowMs = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null; const step = Math.floor(nowMs / 30000);
  for (const s of [step, step - 1, step + 1]) if (eq(hotp(key, s), code)) return s; return null;
}

/* ---------- secret protection ---------- */
function encKey() {
  const k = process.env.MFA_ENC_KEY;
  if (k) { const b = Buffer.from(k, 'base64'); if (b.length !== 32) throw new AppError('mfa_not_configured', 'MFA_ENC_KEY must be 32 bytes, base64', 503); return b; }
  if (process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging') throw new AppError('mfa_not_configured', 'Two-step sign-in is not configured on this server', 503);
  return createHash('sha256').update('dev-only-mfa-key').digest(); // development and tests only
}
const seal = (plain: Buffer) => { const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', encKey(), iv); const ct = Buffer.concat([c.update(plain), c.final()]); return [iv, c.getAuthTag(), ct].map(x => x.toString('base64')).join('.'); };
const open = (s: string) => { const [iv, tag, ct] = s.split('.').map(x => Buffer.from(x, 'base64')); const d = createDecipheriv('aes-256-gcm', encKey(), iv); d.setAuthTag(tag); return Buffer.concat([d.update(ct), d.final()]); };

const audit = (c: { query: Function }, a: { actor?: string | null; tenant?: string | null; action: string; id?: string; outcome: string }) =>
  c.query('insert into audit_log(actor_user_id,tenant_id,action,object_type,object_id,outcome) values($1,$2,$3,$4,$5,$6)', [a.actor ?? null, a.tenant ?? null, a.action, 'user', a.id ?? null, a.outcome]);
const notice = (c: { query: Function }, userId: string, template: string) =>
  c.query("insert into email_outbox(to_email,template,body) select email,$2,'{}' from users where id=$1", [userId, template]);

/* ---------- recovery codes ---------- */
const normCode = (s: string) => s.replace(/[\s-]/g, '').toLowerCase();
const hashCode = (s: string) => sha('mfa-recovery:' + normCode(s));
async function newRecoveryCodes(c: { query: Function }, userId: string) {
  await c.query('delete from mfa_recovery_codes where user_id=$1', [userId]);
  const codes: string[] = [];
  for (let i = 0; i < LIMITS.recoveryCodes; i++) { const h = randomBytes(6).toString('hex'); const code = `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8)}`; codes.push(code); await c.query('insert into mfa_recovery_codes(user_id,code_hash) values($1,$2)', [userId, hashCode(code)]); }
  return codes;
}

/** Two-step is required when the role is in MFA_REQUIRED_ROLES, or when the user has a vendor staff role in a store whose latest settings version requires it for staff. */
export async function userRequiresMfa(c: { query: Function }, userId: string): Promise<boolean> {
  const rows = (await c.query(`select m.role, coalesce((select v.require_staff_mfa from vendor_settings_versions v where v.tenant_id=m.tenant_id order by v.version desc limit 1), false) as store_requires
     from memberships m join tenants t on t.id=m.tenant_id where m.user_id=$1 and m.revoked_at is null and t.status in ('active','closing')`, [userId])).rows as { role: string; store_requires: boolean }[];
  return rows.some(r => requiredRoles().includes(r.role) || (r.role.startsWith('vendor_') && r.store_requires));
}

/* ---------- enrolment ---------- */
export async function mfaStatus(actor: Actor) {
  const u = (await getPool().query('select mfa_enabled_at from users where id=$1', [actor.userId])).rows[0];
  const left = (await getPool().query('select count(*)::int n from mfa_recovery_codes where user_id=$1 and used_at is null', [actor.userId])).rows[0].n;
  return { enabled: !!u.mfa_enabled_at, required: await userRequiresMfa(getPool(), actor.userId), recoveryCodesLeft: left as number };
}
export async function startEnrolment(actor: Actor) {
  const u = (await getPool().query('select email, mfa_enabled_at from users where id=$1', [actor.userId])).rows[0];
  if (u.mfa_enabled_at) throw new AppError('already_enabled', 'Two-step sign-in is already on', 409);
  const key = randomBytes(20); const secret = base32(key);
  await getPool().query('update users set mfa_pending_secret=$2 where id=$1', [actor.userId, seal(key)]);
  const uri = `otpauth://totp/${ISSUER}:${encodeURIComponent(u.email)}?secret=${secret}&issuer=${ISSUER}&algorithm=SHA1&digits=6&period=30`;
  return { secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}
export async function confirmEnrolment(actor: Actor, code: string, nowMs = Date.now()) {
  return tx(async c => {
    const u = (await c.query('select mfa_pending_secret, mfa_enabled_at from users where id=$1 for update', [actor.userId])).rows[0];
    if (u.mfa_enabled_at) throw new AppError('already_enabled', 'Two-step sign-in is already on', 409);
    if (!u.mfa_pending_secret) throw new AppError('not_started', 'Start setup first', 409);
    const key = open(u.mfa_pending_secret); const step = matchTotp(key, String(code ?? '').trim(), nowMs);
    if (step === null) throw new AppError('invalid_code', 'That code is not right. Check the time on your phone and try again.', 422);
    await c.query('update users set mfa_secret=$2, mfa_pending_secret=null, mfa_enabled_at=now(), mfa_last_step=$3 where id=$1', [actor.userId, seal(key), step]);
    const codes = await newRecoveryCodes(c, actor.userId);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'mfa.enrolled', id: actor.userId, outcome: 'ok' });
    return { recoveryCodes: codes };
  });
}
/** Verifies a current TOTP for an already-signed-in user (used before sensitive MFA changes). Not replayable. */
export async function proveTotp(c: { query: Function }, userId: string, code: string) {
  const u = (await c.query('select mfa_secret, mfa_last_step from users where id=$1 for update', [userId])).rows[0];
  if (!u?.mfa_secret) throw new AppError('not_enabled', 'Two-step sign-in is not on', 409);
  const step = matchTotp(open(u.mfa_secret), String(code ?? '').trim());
  if (step === null || (u.mfa_last_step !== null && step <= Number(u.mfa_last_step))) throw new AppError('invalid_code', 'That code is not right or was already used. Wait for the next one.', 422);
  await c.query('update users set mfa_last_step=$2 where id=$1', [userId, step]);
}
export async function regenerateRecoveryCodes(actor: Actor, code: string) {
  return tx(async c => { await proveTotp(c, actor.userId, code); const codes = await newRecoveryCodes(c, actor.userId); await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'mfa.codes_regenerated', id: actor.userId, outcome: 'ok' }); return { recoveryCodes: codes }; });
}
export async function disableMfa(actor: Actor, code: string) {
  return tx(async c => {
    if (await userRequiresMfa(c, actor.userId)) throw new AppError('mfa_required', 'Your role or your store requires two-step sign-in, so it cannot be turned off', 403);
    await proveTotp(c, actor.userId, code);
    await c.query('update users set mfa_secret=null, mfa_pending_secret=null, mfa_enabled_at=null, mfa_last_step=null where id=$1', [actor.userId]);
    await c.query('delete from mfa_recovery_codes where user_id=$1', [actor.userId]);
    await c.query('delete from sessions where user_id=$1', [actor.userId]); // sign out everywhere
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'mfa.disabled', id: actor.userId, outcome: 'ok' });
    await notice(c, actor.userId, 'mfa_disabled');
  });
}
/** Assisted recovery for a user who lost both their device and recovery codes. Never for yourself (no self-approval). */
export async function resetMfa(actor: Actor, targetUserId: string, reason: string) {
  if (!['platform_owner', 'vendor_admin'].includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  if (targetUserId === actor.userId) throw new AppError('self_reset', 'You cannot reset your own two-step sign-in. Ask another administrator.', 403);
  if (String(reason ?? '').trim().length < 5) throw new AppError('reason_required', 'Give a reason for the reset');
  return tx(async c => {
    const t = await c.query('select 1 from memberships m where m.user_id=$1 and m.revoked_at is null and ($3 = \'platform_owner\' or m.tenant_id=$2)', [targetUserId, actor.tenantId, actor.role]);
    if (!t.rowCount) throw new AppError('not_found', 'User not found', 404);
    await c.query('update users set mfa_secret=null, mfa_pending_secret=null, mfa_enabled_at=null, mfa_last_step=null where id=$1', [targetUserId]);
    await c.query('delete from mfa_recovery_codes where user_id=$1', [targetUserId]);
    await c.query('delete from sessions where user_id=$1', [targetUserId]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'mfa.reset', id: targetUserId, outcome: reason.trim().slice(0, 200) });
    await notice(c, targetUserId, 'mfa_reset');
  });
}

/* ---------- sign-in: lockout, challenge ---------- */
const hashKey = (s: string) => sha((process.env.AUTH_HASH_SALT ?? 'dev-only-salt') + s.trim().toLowerCase());
export const keys = (email: string, source: string) => ({ email: hashKey('e:' + email), source: hashKey('s:' + source) });
export async function assertNotLocked(c: { query: Function }, k: { email: string; source: string }) {
  const w = `now() - interval '${LIMITS.windowMinutes} minutes'`;
  const e = (await c.query(`select count(*)::int n from login_failures where email_key=$1 and created_at>${w}`, [k.email])).rows[0].n;
  const s = (await c.query(`select count(*)::int n from login_failures where source_key=$1 and created_at>${w}`, [k.source])).rows[0].n;
  if (e >= LIMITS.emailFailures || s >= LIMITS.sourceFailures) throw new AppError('too_many_attempts', `Too many failed attempts. Try again in ${LIMITS.windowMinutes} minutes.`, 429);
}
export const recordFailure = (c: { query: Function }, k: { email: string; source: string }) => c.query('insert into login_failures(email_key,source_key) values($1,$2)', [k.email, k.source]);
/** Records one 'auth.locked_out' row at the moment a limit is reached (not on every later blocked request, so an attack cannot flood the log). */
export async function auditLockoutCrossing(c: { query: Function }, k: { email: string; source: string }, actor: string | null) {
  const w = `now() - interval '${LIMITS.windowMinutes} minutes'`;
  const e = (await c.query(`select count(*)::int n from login_failures where email_key=$1 and created_at>${w}`, [k.email])).rows[0].n;
  const s = (await c.query(`select count(*)::int n from login_failures where source_key=$1 and created_at>${w}`, [k.source])).rows[0].n;
  if (e === LIMITS.emailFailures || s === LIMITS.sourceFailures) await c.query("insert into audit_log(actor_user_id,action,object_type,outcome) values($1,'auth.locked_out','user',$2)", [actor, e === LIMITS.emailFailures ? 'email_limit' : 'source_limit']);
}
export const lockKey = (c: { query: Function }, k: { email: string }) => c.query('select pg_advisory_xact_lock(hashtext($1))', [k.email]);

export async function createChallenge(c: { query: Function }, userId: string) {
  const token = randomBytes(32).toString('base64url');
  await c.query("insert into mfa_challenges(token_hash,user_id,expires_at) values($1,$2, now() + ($3 || ' minutes')::interval)", [sha(token), userId, String(LIMITS.challengeMinutes)]);
  return token;
}
/** Second step. A wrong code counts against both the challenge and the sign-in lockout. Recovery codes are single use. */
export async function verifyChallenge(challenge: string, code: string, source: string) {
  const bad = () => new AppError('invalid_code', 'That code is not right.', 401);
  return tx(async c => {
    const ch = (await c.query('select id, user_id, attempts from mfa_challenges where token_hash=$1 and used_at is null and expires_at>now() for update', [sha(String(challenge ?? ''))])).rows[0];
    if (!ch) throw new AppError('challenge_expired', 'Your sign-in timed out. Enter your password again.', 401);
    const u = (await c.query('select email, mfa_secret, mfa_last_step from users where id=$1 and status=\'active\' for update', [ch.user_id])).rows[0];
    const k = keys(u?.email ?? '', source); await lockKey(c, k); await assertNotLocked(c, k);
    if (ch.attempts >= LIMITS.challengeAttempts) throw new AppError('challenge_expired', 'Too many wrong codes. Enter your password again.', 401);
    await c.query('update mfa_challenges set attempts=attempts+1 where id=$1', [ch.id]);
    const raw = String(code ?? '').trim(); let used: 'totp' | 'recovery' | null = null;
    if (u?.mfa_secret && /^\d{6}$/.test(raw)) {
      const step = matchTotp(open(u.mfa_secret), raw);
      if (step !== null && (u.mfa_last_step === null || step > Number(u.mfa_last_step))) { await c.query('update users set mfa_last_step=$2 where id=$1', [ch.user_id, step]); used = 'totp'; }
    } else if (u && /^[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}$/i.test(raw)) {
      const r = await c.query('update mfa_recovery_codes set used_at=now() where id=(select id from mfa_recovery_codes where user_id=$1 and code_hash=$2 and used_at is null limit 1) returning id', [ch.user_id, hashCode(raw)]);
      if (r.rowCount) used = 'recovery';
    }
    if (!used) { await recordFailure(c, k); await audit(c, { actor: ch.user_id, action: 'auth.code_failed', outcome: 'denied' }); await auditLockoutCrossing(c, k, ch.user_id); return { fail: true as const }; } // commit the attempt count and the failure, then reject below
    await c.query('update mfa_challenges set used_at=now() where id=$1', [ch.id]);
    await c.query('delete from login_failures where email_key=$1', [k.email]);
    if (used === 'recovery') { await audit(c, { actor: ch.user_id, action: 'mfa.recovery_used', id: ch.user_id, outcome: 'ok' }); await notice(c, ch.user_id, 'mfa_recovery_used'); }
    return { fail: false as const, userId: ch.user_id as string, usedRecovery: used === 'recovery' };
  }).then(async r => { if (r.fail) throw bad(); return { userId: r.userId, usedRecovery: r.usedRecovery, token: await issueSession(r.userId) }; });
}
