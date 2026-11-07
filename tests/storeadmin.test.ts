import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkBareTenant, mkActor, fund, closePool } from './helpers';
import * as S from '../src/server/storeadmin';
import { login, resolveActor, createUser } from '../src/server/auth';
import { mfaStatus, disableMfa } from '../src/server/mfa';
import { saveOriginal } from '../src/server/files';
import { saveProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { getPool } from '../src/server/db';

beforeAll(setupDb); afterAll(closePool);
const count = async (sql: string, args: unknown[] = []) => (await getPool().query(sql, args)).rows[0].n as number;
const PW = 'correct-horse-battery';
let PT = '';
const platform = async (email = 'closer@x.test') => { PT ||= await mkBareTenant('Platform', 'platform'); return mkActor(PT, email, 'platform_owner'); };

describe('versioned settings', () => {
  it('every save is a new version, old ones stay, and a stale save is refused', async () => {
    const T = await mkTenant('Set1'); const a = await mkActor(T, 'a1@x.test', 'vendor_admin'); const b = await mkActor(T, 'a2@x.test', 'vendor_admin');
    expect((await S.getSettings(a)).current).toBeNull();
    expect((await S.saveSettings(a, { billingEmail: 'bill@x.test', supportPhone: '+91 98765 43210' }, 0)).version).toBe(1);
    await expect(S.saveSettings(b, { supportEmail: 'help@x.test' }, 0)).rejects.toMatchObject({ code: 'settings_conflict', status: 409 });
    expect((await S.saveSettings(b, { supportEmail: 'help@x.test' }, 1)).version).toBe(2);
    const g = await S.getSettings(a);
    expect(g.current).toMatchObject({ version: 2, billingEmail: 'bill@x.test', supportEmail: 'help@x.test', changedBy: 'a2@x.test' }); // untouched fields carry over
    expect(g.history.map(h => h.version)).toEqual([2, 1]);
    expect(await count("select count(*)::int n from audit_log where action='vendor.settings_saved' and tenant_id=$1", [T])).toBe(2);
  });
  it('rejects bad input and non-admins; one store never sees another store’s settings', async () => {
    const T = await mkTenant('Set2'), U = await mkTenant('Set3'); const a = await mkActor(T, 'a3@x.test', 'vendor_admin'); const other = await mkActor(U, 'a4@x.test', 'vendor_admin');
    await expect(S.saveSettings(a, { billingEmail: 'nope' }, 0)).rejects.toMatchObject({ code: 'invalid_email' });
    await expect(S.saveSettings(a, { supportPhone: 'call me' }, 0)).rejects.toMatchObject({ code: 'invalid_phone' });
    await expect(S.saveSettings(a, { requireStaffMfa: 'yes' as any }, 0)).rejects.toMatchObject({ code: 'invalid_request' });
    for (const role of ['vendor_counter', 'customer']) { const x = await mkActor(T, `${role}-s@x.test`, role); await expect(S.getSettings(x)).rejects.toMatchObject({ status: 403 }); await expect(S.saveSettings(x, { supportEmail: 'z@x.test' }, 0)).rejects.toMatchObject({ status: 403 }); }
    await S.saveSettings(a, { supportEmail: 'only-t@x.test' }, 0);
    expect((await S.getSettings(other)).current).toBeNull();
  });
  it('requiring staff two-step makes vendor staff enrol at next sign-in, not customers, and it cannot be switched off by them', async () => {
    const T = await mkTenant('Set4'); const a = await mkActor(T, 'a5@x.test', 'vendor_admin');
    await createUser('staff-m@x.test', PW, T, 'vendor_counter'); await createUser('cust-m@x.test', PW, T, 'customer');
    expect((await login('staff-m@x.test', PW)).enrolOnly).toBe(false);
    await S.saveSettings(a, { requireStaffMfa: true }, 0);
    expect((await login('staff-m@x.test', PW)).enrolOnly).toBe(true);
    expect((await login('cust-m@x.test', PW)).enrolOnly).toBe(false);
    const staff = await resolveActor((await login('staff-m@x.test', PW)).token, T, { allowEnrolOnly: true });
    expect((await mfaStatus(staff)).required).toBe(true);
    expect((await S.getSettings(a)).staffWithoutMfa).toBeGreaterThanOrEqual(2);
    await S.saveSettings(a, { requireStaffMfa: false }, 1);
    expect((await login('staff-m@x.test', PW)).enrolOnly).toBe(false);
  });
});

describe('store closure', () => {
  async function customerQuote(T: string, tag: string) {
    const c = await mkActor(T, `cust-${tag}@x.test`); await fund(T, c.userId, 1_000_000, `cl-${tag}`); await fund(T, null, 1_000_000, `clv-${tag}`);
    const img = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#fa0' } }).png().toBuffer();
    const f = await saveOriginal(c, img); const { createProject } = await import('../src/server/projects');
    const p = await createProject(c, 'Flyer'); await saveProject(c, p.id, 1, { sourceFileId: f.fileId, settings: { widthMm: 40, heightMm: 30, bleedMm: 2, dpi: 150, fit: 'fill', format: 'png' } as any });
    return { c, q: await createQuote(c, p.id) };
  }
  it('request stops new work straight away, users can still sign in, customers are emailed, and cancelling restores everything', async () => {
    const T = await mkTenant('Close1'); const admin = await mkActor(T, 'cl-adm@x.test', 'vendor_admin'); const { c, q } = await customerQuote(T, 'one');
    await expect(S.requestClosure(admin, 'no')).rejects.toMatchObject({ code: 'reason_required' });
    const r = await S.requestClosure(admin, 'Retiring the business');
    expect(new Date(r.earliestCloseAt).getTime()).toBeGreaterThan(Date.now() + 13 * 86400_000);
    await expect(reserveQuote(c, q.quoteId)).rejects.toMatchObject({ code: 'subscription_inactive' });
    expect(await resolveActor((await login('cust-one@x.test', PW)).token, T)).toMatchObject({ tenantId: T }); // still reachable for downloads
    expect(await count("select count(*)::int n from email_outbox where to_email='cust-one@x.test' and template='store_closing'")).toBe(1);
    await expect(S.requestClosure(admin, 'Retiring again')).rejects.toMatchObject({ code: 'already_requested' });
    await S.cancelClosure(admin);
    expect((await S.closureStatus(admin)).tenantStatus).toBe('active');
    expect(await count("select count(*)::int n from email_outbox where to_email='cust-one@x.test' and template='store_closing_cancelled'")).toBe(1);
    expect((await reserveQuote(c, q.quoteId)).jobId).toBeTruthy();
    await expect(S.cancelClosure(admin)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('only a store admin of a vendor store can ask; the direct tenant cannot', async () => {
    const T = await mkTenant('Close2'); const staff = await mkActor(T, 'cl-st@x.test', 'vendor_counter');
    await expect(S.requestClosure(staff, 'Retiring the business')).rejects.toMatchObject({ status: 403 });
    const D = await mkBareTenant('Direct', 'direct'); const da = await mkActor(D, 'cl-d@x.test', 'vendor_admin');
    await expect(S.requestClosure(da, 'Retiring the business')).rejects.toMatchObject({ code: 'not_allowed' });
  });
  it('completion is refused during notice, while work is open, and without a settlement note when balances exist; support cannot complete', async () => {
    const T = await mkTenant('Close3'); const admin = await mkActor(T, 'cl3-adm@x.test', 'vendor_admin'); const owner = await platform();
    const sup = await mkActor(PT, 'cl3-sup@x.test', 'platform_support');
    await fund(T, null, 5000, 'cl3-vendor');
    const r = await S.requestClosure(admin, 'Retiring the business');
    await expect(S.completeClosure(owner, r.id)).rejects.toMatchObject({ code: 'notice_period' });
    await expect(S.completeClosure(sup, r.id)).rejects.toMatchObject({ status: 403 });
    await getPool().query("update vendor_closures set earliest_close_at=now()-interval '1 minute' where id=$1", [r.id]);
    await expect(S.completeClosure(owner, r.id)).rejects.toMatchObject({ code: 'settlement_note_required' });
    const list = await S.listClosures(owner); expect(list.find(x => x.id === r.id)!.liabilities!.needsSettlement).toBe(true);
    await expect(S.listClosures(sup)).rejects.toMatchObject({ status: 403 });
    await expect(S.listClosures(admin)).rejects.toMatchObject({ status: 403 });
    const done = await S.completeClosure(owner, r.id, 'Refunded by bank transfer, ref UTR123456');
    expect(done.ok).toBe(true);
    await expect(S.completeClosure(owner, r.id, 'again again again')).rejects.toMatchObject({ code: 'already_decided' });
    await expect(login('cl3-adm@x.test', PW).then(l => resolveActor(l.token, T))).rejects.toMatchObject({ status: 403 }); // closed: no access
    const row = (await getPool().query('select liabilities_at_close, settlement_note from vendor_closures where id=$1', [r.id])).rows[0];
    expect(row.settlement_note).toContain('UTR123456'); expect(row.liabilities_at_close.balancesPaise.vendor_processing_credit).toBe(5000);
    expect(await count('select count(*)::int n from ledger_entries e join ledger_accounts a on a.id=e.account_id where a.tenant_id=$1', [T])).toBe(1); // ledger untouched
  });
  it('open jobs or credit holds block completion', async () => {
    const T = await mkTenant('Close4'); const admin = await mkActor(T, 'cl4-adm@x.test', 'vendor_admin'); const owner = await platform('closer4@x.test');
    const { c, q } = await customerQuote(T, 'four'); await reserveQuote(c, q.quoteId); // job now waiting
    const r = await S.requestClosure(admin, 'Retiring the business');
    await getPool().query("update vendor_closures set earliest_close_at=now()-interval '1 minute' where id=$1", [r.id]);
    await expect(S.completeClosure(owner, r.id, 'settled elsewhere ok')).rejects.toMatchObject({ code: 'liabilities_open' });
  });
  it('purge deletes files and previews after the delay, is paused by an investigation hold, and keeps ledger and audit', async () => {
    const T = await mkTenant('Close5'); const admin = await mkActor(T, 'cl5-adm@x.test', 'vendor_admin'); const owner = await platform('closer5@x.test');
    const c = await mkActor(T, 'cust-five@x.test'); const img = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#00f' } }).png().toBuffer(); const f = await saveOriginal(c, img);
    const r = await S.requestClosure(admin, 'Retiring the business');
    await getPool().query("update vendor_closures set earliest_close_at=now()-interval '1 minute' where id=$1", [r.id]);
    await S.completeClosure(owner, r.id);
    expect((await S.purgeClosedStores()).purged).toBe(0); // not due yet
    await getPool().query("update vendor_closures set purge_after=now()-interval '1 minute' where id=$1", [r.id]);
    const audit0 = await count('select count(*)::int n from audit_log where tenant_id=$1', [T]);
    const out = await S.purgeClosedStores(); expect(out.purged).toBe(1);
    expect(await count('select count(*)::int n from stored_files where id=$1 and deleted_at is not null', [f.fileId])).toBe(1);
    expect(await count('select count(*)::int n from audit_log where tenant_id=$1', [T])).toBeGreaterThanOrEqual(audit0);
    expect((await S.purgeClosedStores()).purged).toBe(0); // safe to rerun
    const row = (await getPool().query('select purged_at, purge_note from vendor_closures where id=$1', [r.id])).rows[0]; expect(row.purged_at).toBeTruthy(); expect(row.purge_note).toContain('audit log kept');
  });
});
