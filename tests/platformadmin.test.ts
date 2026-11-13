import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupDb, mkTenant, mkActor, closePool } from './helpers';
import { getPool } from '../src/server/db';
import * as A from '../src/server/platformadmin';
import { acceptInvite } from '../src/server/identity';
import { login, resolveActor, type Actor } from '../src/server/auth';

let PT = '', owner: Actor, sup: Actor, fin: Actor;
beforeAll(async () => { await setupDb(); PT = await mkTenant('Platform', 'platform'); owner = await mkActor(PT, 'own@pa.test', 'platform_owner'); sup = await mkActor(PT, 'sup@pa.test', 'platform_support'); fin = await mkActor(PT, 'fin@pa.test', 'platform_finance'); });
afterAll(closePool);
const PW = 'correct-horse-battery';

describe('stores: suspend and reactivate (SC-056)', () => {
  it('suspension needs a reason, stops access at once, deletes nothing, and only the owner reactivates', async () => {
    const T = await mkTenant('Susp'); const admin = await mkActor(T, 'a@susp.test', 'vendor_admin'); const cust = await mkActor(T, 'c@susp.test');
    await expect(A.suspendTenant(sup, T, 'short')).rejects.toMatchObject({ code: 'reason_required' });
    await expect(A.suspendTenant(admin, T, 'A store cannot suspend itself')).rejects.toMatchObject({ code: 'denied' });
    await expect(A.suspendTenant(fin, T, 'Finance is not operations staff')).rejects.toMatchObject({ code: 'denied' });
    const before = Number((await getPool().query('select count(*)::int n from memberships where tenant_id=$1', [T])).rows[0].n);
    await A.suspendTenant(sup, T, 'Suspected account takeover, ticket SUP-9');
    const { token } = await login('c@susp.test', PW); await expect(resolveActor(token, T)).rejects.toMatchObject({ code: 'denied' });
    expect((await A.tenantDetail(owner, T)).suspendedReason).toMatch(/takeover/);
    expect(Number((await getPool().query('select count(*)::int n from memberships where tenant_id=$1', [T])).rows[0].n)).toBe(before);
    await expect(A.reactivateTenant(sup, T, 'Support cannot reactivate alone')).rejects.toMatchObject({ code: 'denied' });
    await A.reactivateTenant(owner, T, 'Owner confirmed identity by phone');
    expect((await resolveActor(token, T)).userId).toBe(cust.userId);
    await expect(A.tenantDetail(owner, PT)).rejects.toMatchObject({ code: 'not_found' }); // the platform workspace is not a store
  });
});

describe('people (SC-058)', () => {
  it('search needs three characters, shows memberships but no files or balances, and is audited without the search term', async () => {
    const T = await mkTenant('Ppl'); await mkActor(T, 'findme@ppl.test');
    await expect(A.searchPeople(sup, 'fi')).rejects.toMatchObject({ code: 'query_too_short' });
    const r = await A.searchPeople(sup, 'findme@'); expect(r).toHaveLength(1); expect(r[0].memberships[0]).toMatchObject({ store: 'Ppl', role: 'customer' });
    expect(JSON.stringify(r)).not.toMatch(/password|paise|storage_key/);
    expect((await A.searchPeople(sup, '%%%')).length).toBe(0); // wildcards are literal
    const a = (await getPool().query("select outcome from audit_log where action='people.search' order by id desc limit 1")).rows[0]; expect(a.outcome).not.toContain('findme');
    await expect(A.searchPeople(await mkActor(T, 'va@ppl.test', 'vendor_admin'), 'findme')).rejects.toMatchObject({ code: 'denied' });
  });
  it('blocking signs the person out and needs a reason; staff cannot be blocked this way; only the owner unblocks', async () => {
    const T = await mkTenant('Blk'); const c = await mkActor(T, 'bad@blk.test'); const { token } = await login('bad@blk.test', PW);
    await A.blockUser(sup, c.userId, 'Uploading prohibited material');
    await expect(resolveActor(token, T)).rejects.toMatchObject({ code: 'session_expired' });
    await expect(login('bad@blk.test', PW)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(A.blockUser(sup, owner.userId, 'Trying to lock out the owner')).rejects.toMatchObject({ code: 'denied' });
    await expect(A.unblockUser(sup, c.userId, 'Support alone cannot unblock')).rejects.toMatchObject({ code: 'denied' });
    await A.unblockUser(owner, c.userId, 'Appeal accepted after review'); await login('bad@blk.test', PW);
  });
});

describe('platform staff (SC-059, AT-29)', () => {
  it('only the owner invites; the invitation creates a separate account with exactly the invited role', async () => {
    await expect(A.invitePlatformStaff(sup, 'x@pa.test', 'platform_owner')).rejects.toMatchObject({ code: 'denied' });
    await expect(A.invitePlatformStaff(owner, 'x@pa.test', 'vendor_admin')).rejects.toMatchObject({ code: 'invalid_role' });
    await expect(A.invitePlatformStaff(owner, 'sup@pa.test', 'platform_finance')).rejects.toMatchObject({ code: 'account_exists' });
    await A.invitePlatformStaff(owner, 'newfin@pa.test', 'platform_finance');
    const tok = JSON.parse((await getPool().query("select body from email_outbox where to_email='newfin@pa.test' and template='invite' order by id desc limit 1")).rows[0].body).token;
    await acceptInvite(tok, PW); const a = await resolveActor((await login('newfin@pa.test', PW)).token, undefined);
    expect(a).toMatchObject({ role: 'platform_finance', tenantId: PT });
    await expect(acceptInvite(tok, PW)).rejects.toBeTruthy(); // single use
    expect((await A.listPlatformStaff(owner)).staff.map(s => s.email)).toContain('newfin@pa.test');
  });
  it('nobody changes their own role; the last owner cannot be demoted or removed; a role change signs the person out', async () => {
    const list = await A.listPlatformStaff(owner); const me = list.staff.find(s => s.me)!; const s = list.staff.find(x => x.email === 'sup@pa.test')!;
    await expect(A.changePlatformStaff(owner, me.id, { role: 'platform_support' })).rejects.toMatchObject({ code: 'self_change' });
    const owner2 = await mkActor(PT, 'own2@pa.test', 'platform_owner');
    await A.changePlatformStaff(owner2, me.id, { role: 'platform_support' }); // now owner2 is the only owner
    const o2 = (await A.listPlatformStaff(owner2)).staff.find(x => x.me)!;
    await expect(A.changePlatformStaff(owner, o2.id, { remove: true })).rejects.toMatchObject({ code: 'denied' }); // the demoted owner has no say
    const { token } = await login('sup@pa.test', PW); await A.changePlatformStaff(owner2, s.id, { role: 'platform_owner' });
    await expect(resolveActor(token, PT)).rejects.toMatchObject({ code: 'session_expired' });
    const promoted = await resolveActor((await login('sup@pa.test', PW)).token, PT);
    await A.changePlatformStaff(promoted, o2.id, { remove: true }); // two owners existed, so one may go
    const last = (await A.listPlatformStaff(promoted)).staff.filter(x => x.role === 'platform_owner'); expect(last).toHaveLength(1);
    const other = await mkActor(PT, 'own3@pa.test', 'platform_owner'); await A.changePlatformStaff(other, last[0].id, { remove: true });
    const only = (await A.listPlatformStaff(other)).staff.find(x => x.me)!;
    await expect(A.changePlatformStaff(other, only.id, { remove: true })).rejects.toMatchObject({ code: 'self_change' });
    owner = other;
  });
});

describe('configuration, direct store and incident register (SC-057, SC-073, SC-074)', () => {
  it('configuration shows what is switched on and never a secret value', async () => {
    process.env.RAZORPAY_KEY_SECRET = 'super-secret-value'; process.env.SMTP_PASSWORD = 'smtp-secret-value';
    const c = await A.configStatus(fin); const dump = JSON.stringify(c);
    expect(dump).not.toContain('super-secret-value'); expect(dump).not.toContain('smtp-secret-value');
    expect(c.limits).toMatchObject({ quoteMinutes: 15, retentionDays: 90 });
    await expect(A.configStatus(await mkActor(await mkTenant('Cfg'), 'c@cfg.test'))).rejects.toMatchObject({ code: 'denied' });
    await expect(A.sendTestEmail(fin)).rejects.toMatchObject({ code: 'denied' });
    await A.sendTestEmail(owner); expect((await getPool().query("select to_email from email_outbox where template='test_message'")).rows[0].to_email).toBe('own3@pa.test'); // only ever to the owner's own address
  });
  it('direct store view gives counts and references, and only the owner sets its price', async () => {
    expect((await A.directStore(owner)).exists).toBe(false);
    const D = await mkTenant('Direct', 'direct'); await getPool().query("insert into vendor_profiles(tenant_id,display_name,slug) values($1,'Direct','direct-store')", [D]); await mkActor(D, 'dc@pa.test');
    const d = await A.directStore(owner) as any; expect(d).toMatchObject({ exists: true, customers: 1, slug: 'direct-store' });
    const sup2 = await mkActor(PT, 'sup2@pa.test', 'platform_support');
    await expect(A.setDirectPrice(sup2, 700, 1500)).rejects.toMatchObject({ code: 'denied' });
    await A.setDirectPrice(owner, 700, 1500); expect(((await A.directStore(sup2)) as any).price).toEqual({ perMpPaise: 700, minPaise: 1500 });
  });
  it('an incident moves through fixed steps; restore needs a backup reference; only the owner approves reopening, with evidence', async () => {
    const i = await A.recordIncident(fin, { title: 'Database host failure', severity: 'critical', scope: 'All stores; database unavailable since 02:10' });
    await expect(A.advanceIncident(fin, i.id, { to: 'reopened', note: 'Skipping straight to reopen' })).rejects.toMatchObject({ code: 'invalid_transition' });
    await A.advanceIncident(fin, i.id, { to: 'contained', note: 'Traffic stopped, payouts paused' });
    await expect(A.advanceIncident(fin, i.id, { to: 'restored', note: 'Restored without saying from what' })).rejects.toMatchObject({ code: 'backup_required' });
    await A.advanceIncident(fin, i.id, { to: 'restored', note: 'Restored database and files together', backupRef: 'backup-2026-11-13T01:00' });
    await A.advanceIncident(fin, i.id, { to: 'reconciled', note: 'Provider events since backup re-applied' });
    await expect(A.advanceIncident(fin, i.id, { to: 'reopened', note: 'Finance trying to reopen', evidence: 'x' })).rejects.toMatchObject({ code: 'denied' });
    await expect(A.advanceIncident(owner, i.id, { to: 'reopened', note: 'Owner without any evidence' })).rejects.toMatchObject({ code: 'evidence_required' });
    await A.advanceIncident(owner, i.id, { to: 'reopened', note: 'Smoke tests passed, reopening', evidence: 'Smoke run 14, reconciliation FX-22' });
    const row = (await A.listIncidents(fin)).incidents.find(x => x.id === i.id)!; expect(row.status).toBe('reopened'); expect(row.notes).toHaveLength(4); expect(row.approver).toBe('own3@pa.test');
    await expect(A.listIncidents(await mkActor(await mkTenant('Inc'), 'c@inc.test'))).rejects.toMatchObject({ code: 'denied' });
  });
});
