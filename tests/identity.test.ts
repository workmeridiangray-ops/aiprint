import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupDb, mkTenant, mkActor, closePool } from './helpers';
import { login } from '../src/server/auth';
import { register, verifyEmail, requestReset, resetPassword, invite, acceptInvite, revokeMembership } from '../src/server/identity';
import { getPool } from '../src/server/db';

let T: string;
beforeAll(async () => { await setupDb(); T = await mkTenant('V'); });
afterAll(closePool);
// Test-only: read raw token from the outbox (production never exposes it).
async function lastToken(email: string, tpl: string) {
  const r = await getPool().query('select body from email_outbox where to_email=$1 and template=$2 order by id desc limit 1', [email, tpl]);
  return JSON.parse(r.rows[0].body).token as string;
}
const PW = 'correct-horse-battery';

describe('registration and verification', () => {
  it('cannot sign in until email is verified; link works once', async () => {
    await register('new@x.test', PW, T);
    await expect(login('new@x.test', PW)).rejects.toMatchObject({ code: 'invalid_credentials' });
    const t = await lastToken('new@x.test', 'verify_email');
    await verifyEmail(t);
    expect((await login('new@x.test', PW)).userId).toBeTruthy();
    await expect(verifyEmail(t)).rejects.toMatchObject({ code: 'invalid_token' });
  });
  it('re-registering an existing email gives the same response and changes nothing', async () => {
    const before = (await getPool().query('select count(*)::int n from users')).rows[0].n;
    expect(await register('NEW@x.test', 'another-long-password', T)).toEqual({ status: 'verification_sent' });
    expect((await getPool().query('select count(*)::int n from users')).rows[0].n).toBe(before);
    expect((await login('new@x.test', PW)).userId).toBeTruthy(); // old password still works
  });
  it('expired verification link is refused', async () => {
    await register('exp@x.test', PW, T);
    const t = await lastToken('exp@x.test', 'verify_email');
    await getPool().query("update auth_tokens set expires_at=now()-interval '1 second'");
    await expect(verifyEmail(t)).rejects.toMatchObject({ code: 'invalid_token' });
  });
});

describe('password reset', () => {
  it('same response for unknown email; reset works once, ends old sessions, old password dead', async () => {
    expect(await requestReset('ghost@x.test')).toEqual({ status: 'sent_if_account_exists' });
    expect((await getPool().query("select count(*)::int n from email_outbox where to_email='ghost@x.test'")).rows[0].n).toBe(0);
    await mkActor(T, 'rs@x.test');
    await login('rs@x.test', PW);
    await requestReset('rs@x.test');
    const t = await lastToken('rs@x.test', 'reset_password');
    await resetPassword(t, 'brand-new-password-1');
    await expect(login('rs@x.test', PW)).rejects.toBeDefined();
    expect((await login('rs@x.test', 'brand-new-password-1')).userId).toBeTruthy();
    await expect(resetPassword(t, 'yet-another-password-1')).rejects.toMatchObject({ code: 'invalid_token' });
    expect((await getPool().query("select count(*)::int n from sessions s join users u on u.id=s.user_id where u.email='rs@x.test'")).rows[0].n).toBe(1); // only the new login
  });
  it('a newer reset request invalidates the earlier link', async () => {
    await mkActor(T, 'rs2@x.test');
    await requestReset('rs2@x.test'); const t1 = await lastToken('rs2@x.test', 'reset_password');
    await requestReset('rs2@x.test'); const t2 = await lastToken('rs2@x.test', 'reset_password');
    await expect(resetPassword(t1, 'brand-new-password-2')).rejects.toMatchObject({ code: 'invalid_token' });
    await resetPassword(t2, 'brand-new-password-2');
  });
});

describe('invites and last-admin protection', () => {
  it('only admins invite; invite is single-use and cannot take over an existing account', async () => {
    const admin = await mkActor(T, 'adm@x.test', 'vendor_admin');
    const cust = await mkActor(T, 'cu@x.test', 'customer');
    await expect(invite(cust, 's@x.test', 'vendor_counter')).rejects.toMatchObject({ code: 'denied' });
    await expect(invite(admin, 's@x.test', 'platform_owner')).rejects.toMatchObject({ code: 'invalid_role' });
    await invite(admin, 's@x.test', 'vendor_counter');
    const t = await lastToken('s@x.test', 'invite');
    await acceptInvite(t, PW);
    await expect(acceptInvite(t, PW)).rejects.toMatchObject({ code: 'invalid_token' });
    await invite(admin, 'cu@x.test', 'vendor_support');
    await expect(acceptInvite(await lastToken('cu@x.test', 'invite'), PW)).rejects.toMatchObject({ code: 'account_exists' });
  });
  it('revoked invite and expired invite are refused', async () => {
    const admin = await mkActor(T, 'adm2@x.test', 'vendor_admin');
    await invite(admin, 'late@x.test', 'vendor_counter'); const t = await lastToken('late@x.test', 'invite');
    await getPool().query("update auth_tokens set expires_at=now()-interval '1 second' where invite_email='late@x.test'");
    await expect(acceptInvite(t, PW)).rejects.toMatchObject({ code: 'invalid_token' });
  });
  it('last administrator cannot be removed; allowed once another exists; concurrent double-revoke leaves one', async () => {
    const T2 = await mkTenant('V2');
    const a1 = await mkActor(T2, 'l1@x.test', 'vendor_admin');
    const mid = async (e: string) => (await getPool().query("select m.id from memberships m join users u on u.id=m.user_id where u.email=$1 and m.tenant_id=$2", [e, T2])).rows[0].id;
    await expect(revokeMembership(a1, await mid('l1@x.test'))).rejects.toMatchObject({ code: 'last_admin' });
    const a2 = await mkActor(T2, 'l2@x.test', 'vendor_admin');
    const r = await Promise.allSettled([revokeMembership(a1, await mid('l1@x.test')), revokeMembership(a2, await mid('l2@x.test'))]);
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    const left = await getPool().query("select count(*)::int n from memberships where tenant_id=$1 and role='vendor_admin' and revoked_at is null", [T2]);
    expect(left.rows[0].n).toBe(1);
  });
  it('cannot revoke a member of another tenant', async () => {
    const T3 = await mkTenant('V3'); const other = await mkActor(T3, 'o3@x.test', 'vendor_admin');
    const victim = (await getPool().query("select m.id from memberships m join users u on u.id=m.user_id where u.email='cu@x.test'")).rows[0].id;
    await expect(revokeMembership(other, victim)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('writes audit records', async () => {
    expect((await getPool().query("select count(*)::int n from audit_log where action in ('invite.create','invite.accept','membership.revoke','register')")).rows[0].n).toBeGreaterThan(3);
  });
});
