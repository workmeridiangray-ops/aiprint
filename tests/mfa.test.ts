import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupDb, mkTenant, mkActor, closePool } from './helpers';
import { login, resolveActor, logout } from '../src/server/auth';
import { hotp, matchTotp, base32, startEnrolment, confirmEnrolment, verifyChallenge, disableMfa, resetMfa, regenerateRecoveryCodes, mfaStatus, LIMITS } from '../src/server/mfa';
import { getPool } from '../src/server/db';

const PW = 'correct-horse-battery';
let T: string, PT: string;
beforeAll(async () => { await setupDb(); T = await mkTenant('V'); PT = await mkTenant('Platform', 'platform'); });
afterAll(closePool);
afterEach(() => { process.env.MFA_REQUIRED_ROLES = ''; process.env.APP_ENV = 'test'; });

const unb32 = (s: string) => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const out: number[] = []; for (const ch of s) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const stepNow = () => Math.floor(Date.now() / 30000);
async function enrolled(email: string, tenant = T, role = 'customer') {
  const a = await mkActor(tenant, email, role); const s = await startEnrolment(a); const key = unb32(s.secret);
  const { recoveryCodes } = await confirmEnrolment(a, hotp(key, stepNow()));
  return { a, key, recoveryCodes, email };
}
const challengeFor = async (email: string) => { const r = await login(email, PW, 'src-' + email); expect(r.token).toBeUndefined(); return r.challenge!; };

describe('TOTP primitives', () => {
  it('matches the RFC 6238 test vector and base32', () => {
    const key = Buffer.from('12345678901234567890'); expect(hotp(key, 1)).toBe('287082'); expect(matchTotp(key, '287082', 59000)).toBe(1);
    expect(matchTotp(key, '287082', 59000 + 3 * 30000)).toBeNull(); // outside the ±1 window
    expect(base32(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });
});

describe('sign-in lockout', () => {
  it('locks after repeated failures, even for the right password and for unknown emails alike', async () => {
    await mkActor(T, 'lock1@x.test');
    for (let i = 0; i < LIMITS.emailFailures; i++) await expect(login('lock1@x.test', 'wrong-password-123', 'ipA')).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(login('lock1@x.test', PW, 'ipB')).rejects.toMatchObject({ code: 'too_many_attempts', status: 429 });
    for (let i = 0; i < LIMITS.emailFailures; i++) await expect(login('ghost@x.test', 'wrong-password-123', 'ipC')).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(login('ghost@x.test', 'wrong-password-123', 'ipD')).rejects.toMatchObject({ code: 'too_many_attempts' }); // same behaviour as a real account
  });
  it('failures expire after the window, and a good sign-in clears the count', async () => {
    await mkActor(T, 'lock2@x.test');
    for (let i = 0; i < 4; i++) await expect(login('lock2@x.test', 'wrong-password-123', 'ipE')).rejects.toBeDefined();
    expect((await login('lock2@x.test', PW, 'ipE')).token).toBeTruthy();
    for (let i = 0; i < 4; i++) await expect(login('lock2@x.test', 'wrong-password-123', 'ipE')).rejects.toMatchObject({ code: 'invalid_credentials' }); // count restarted
    await expect(login('lock2@x.test', 'wrong-password-123', 'ipE')).rejects.toBeDefined();
    await getPool().query("update login_failures set created_at=now()-interval '16 minutes'");
    expect((await login('lock2@x.test', PW, 'ipE')).token).toBeTruthy();
  });
  it('one source cannot spray many accounts', async () => {
    for (let i = 0; i < LIMITS.sourceFailures; i++) await expect(login(`spray${i}@x.test`, 'wrong-password-123', 'spray-ip')).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(login('spray-new@x.test', 'x', 'spray-ip')).rejects.toMatchObject({ code: 'too_many_attempts' });
  });
});

describe('enrolment and two-step sign-in', () => {
  it('rejects a wrong confirmation code; stores the secret encrypted; issues 10 recovery codes once', async () => {
    const a = await mkActor(T, 'e1@x.test'); const s = await startEnrolment(a);
    expect(s.qr.startsWith('data:image/png;base64,')).toBe(true); expect(s.uri).toContain('secret=' + s.secret);
    await expect(confirmEnrolment(a, '000000')).rejects.toMatchObject({ code: 'invalid_code' });
    expect((await mfaStatus(a)).enabled).toBe(false);
    const { recoveryCodes } = await confirmEnrolment(a, hotp(unb32(s.secret), stepNow()));
    expect(recoveryCodes).toHaveLength(10);
    const row = (await getPool().query('select mfa_secret from users where id=$1', [a.userId])).rows[0];
    expect(row.mfa_secret).not.toContain(s.secret);
    const hashes = (await getPool().query('select code_hash from mfa_recovery_codes where user_id=$1', [a.userId])).rows.map(r => r.code_hash).join();
    for (const c of recoveryCodes) expect(hashes).not.toContain(c.replace(/-/g, ''));
    await expect(startEnrolment(a)).rejects.toMatchObject({ code: 'already_enabled' });
  });
  it('after enrolment, password alone gives a challenge, never a session; a valid code gives one', async () => {
    const x = await enrolled('e2@x.test'); const ch = await challengeFor(x.email);
    const r = await verifyChallenge(ch, hotp(x.key, stepNow() + 1), 'src-' + x.email); // next step: within drift window and newer than enrolment
    expect((await resolveActor(r.token, T)).userId).toBe(x.a.userId);
    await expect(verifyChallenge(ch, hotp(x.key, stepNow() + 1), 'src')).rejects.toMatchObject({ code: 'challenge_expired' }); // challenge is single use
  });
  it('a used code cannot be replayed on a new challenge', async () => {
    const x = await enrolled('e3@x.test');
    await expect(verifyChallenge(await challengeFor(x.email), hotp(x.key, stepNow()), 'src-' + x.email)).rejects.toMatchObject({ code: 'invalid_code' }); // same step as enrolment
    await verifyChallenge(await challengeFor(x.email), hotp(x.key, stepNow() + 1), 'src-' + x.email);
    await expect(verifyChallenge(await challengeFor(x.email), hotp(x.key, stepNow() + 1), 'src-' + x.email)).rejects.toMatchObject({ code: 'invalid_code' });
  });
  it('wrong codes burn the challenge after 5 tries, even if the right code follows', async () => {
    const x = await enrolled('e4@x.test'); const ch = await challengeFor(x.email);
    for (let i = 0; i < LIMITS.challengeAttempts; i++) await expect(verifyChallenge(ch, '123456', 'src-e4')).rejects.toMatchObject({ code: 'invalid_code' });
    await expect(verifyChallenge(ch, hotp(x.key, stepNow() + 1), 'src-e4')).rejects.toMatchObject({ code: expect.stringMatching(/^(challenge_expired|too_many_attempts)$/) }); // both caps trip at 5, either refusal is correct
  });
  it('wrong codes also count toward the sign-in lockout, so new challenges cannot be farmed', async () => {
    const x = await enrolled('e5@x.test'); let n = 0;
    for (; n < LIMITS.emailFailures; n++) { const ch = await challengeFor(x.email).catch(() => null); if (!ch) break; await expect(verifyChallenge(ch, '123456', 'src-e5')).rejects.toBeDefined(); }
    await expect(login(x.email, PW, 'src-e5')).rejects.toMatchObject({ code: 'too_many_attempts' });
  });
  it('recovery codes work once, queue a notice, and are audited', async () => {
    const x = await enrolled('e6@x.test');
    const r = await verifyChallenge(await challengeFor(x.email), x.recoveryCodes[0].toUpperCase(), 'src-e6'); expect(r.usedRecovery).toBe(true);
    await expect(verifyChallenge(await challengeFor(x.email), x.recoveryCodes[0], 'src-e6')).rejects.toMatchObject({ code: 'invalid_code' });
    expect((await mfaStatus(await resolveActor(r.token, T))).recoveryCodesLeft).toBe(9);
    expect((await getPool().query("select count(*)::int n from email_outbox where to_email='e6@x.test' and template='mfa_recovery_used'")).rows[0].n).toBe(1);
    expect((await getPool().query("select count(*)::int n from audit_log where action='mfa.recovery_used' and object_id=$1", [x.a.userId])).rows[0].n).toBe(1);
  });
  it('regenerating recovery codes needs a fresh valid code and invalidates the old set', async () => {
    const x = await enrolled('e7@x.test');
    await expect(regenerateRecoveryCodes(x.a, '000000')).rejects.toMatchObject({ code: 'invalid_code' });
    const n = await regenerateRecoveryCodes(x.a, hotp(x.key, stepNow() + 1)); expect(n.recoveryCodes).toHaveLength(10);
    await expect(verifyChallenge(await challengeFor(x.email), x.recoveryCodes[0], 'src-e7')).rejects.toMatchObject({ code: 'invalid_code' });
    await verifyChallenge(await challengeFor(x.email), n.recoveryCodes[0], 'src-e7');
  });
});

describe('required roles', () => {
  it('a required role gets an enrolment-only session until two-step is set up, and cannot turn it off', async () => {
    process.env.MFA_REQUIRED_ROLES = 'platform_owner';
    const { createUser } = await import('../src/server/auth'); await createUser('own-m@x.test', PW, PT, 'platform_owner');
    const r = await login('own-m@x.test', PW, 'src-own'); expect(r.enrolOnly).toBe(true);
    await expect(resolveActor(r.token, PT)).rejects.toMatchObject({ code: 'mfa_enrolment_required' });
    const a = await resolveActor(r.token, PT, { allowEnrolOnly: true }); const s = await startEnrolment(a);
    await confirmEnrolment(a, hotp(unb32(s.secret), stepNow()));
    expect((await resolveActor(r.token, PT)).userId).toBe(a.userId); // same session is now fully usable
    await expect(disableMfa(a, hotp(unb32(s.secret), stepNow() + 1))).rejects.toMatchObject({ code: 'mfa_required' });
    await logout(r.token!);
  });
  it('production without an encryption key refuses to enrol (fails closed)', async () => {
    const a = await mkActor(T, 'prod@x.test'); const prev = process.env.MFA_ENC_KEY; delete process.env.MFA_ENC_KEY; process.env.APP_ENV = 'production';
    await expect(startEnrolment(a)).rejects.toMatchObject({ code: 'mfa_not_configured' }); if (prev) process.env.MFA_ENC_KEY = prev;
  });
});

describe('disable and assisted reset', () => {
  it('an optional user can turn it off with a valid code, which signs out all sessions', async () => {
    const x = await enrolled('d1@x.test'); const s = await verifyChallenge(await challengeFor(x.email), hotp(x.key, stepNow() + 1), 'src-d1');
    await expect(disableMfa(x.a, '000000')).rejects.toMatchObject({ code: 'invalid_code' });
    await getPool().query('update users set mfa_last_step=mfa_last_step-3 where id=$1', [x.a.userId]); // simulate the 30 s wait that a real user needs before the next code
    await disableMfa(x.a, hotp(x.key, stepNow()));
    await expect(resolveActor(s.token, T)).rejects.toMatchObject({ code: 'session_expired' });
    expect((await login(x.email, PW, 'src-d1')).token).toBeTruthy(); // password alone works again
    expect((await getPool().query('select count(*)::int n from mfa_recovery_codes where user_id=$1', [x.a.userId])).rows[0].n).toBe(0);
  });
  it('reset: another admin only, with a reason; clears MFA, signs the user out, notifies, audits', async () => {
    const x = await enrolled('r1@x.test'); const sess = await verifyChallenge(await challengeFor(x.email), hotp(x.key, stepNow() + 1), 'src-r1');
    const adm = await mkActor(T, 'r1adm@x.test', 'vendor_admin');
    await expect(resetMfa(adm, adm.userId, 'lost phone')).rejects.toMatchObject({ code: 'self_reset' });
    await expect(resetMfa(adm, x.a.userId, 'x')).rejects.toMatchObject({ code: 'reason_required' });
    await expect(resetMfa(x.a, adm.userId, 'trying it on')).rejects.toMatchObject({ code: 'denied' });
    const T2 = await mkTenant('V2'); const foreign = await mkActor(T2, 'r1f@x.test', 'vendor_admin');
    await expect(resetMfa(foreign, x.a.userId, 'not my tenant')).rejects.toMatchObject({ code: 'not_found' });
    await resetMfa(adm, x.a.userId, 'Lost phone, identity verified by phone');
    await expect(resolveActor(sess.token, T)).rejects.toMatchObject({ code: 'session_expired' });
    expect((await login(x.email, PW, 'src-r1')).token).toBeTruthy(); // no longer asks for a code
    expect((await getPool().query("select count(*)::int n from email_outbox where to_email='r1@x.test' and template='mfa_reset'")).rows[0].n).toBe(1);
    expect((await getPool().query("select count(*)::int n from audit_log where action='mfa.reset' and object_id=$1", [x.a.userId])).rows[0].n).toBe(1);
  });
});
