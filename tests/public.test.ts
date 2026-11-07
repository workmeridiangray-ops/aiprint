import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupDb, mkTenant, mkActor, closePool, testPlanId } from './helpers';
import * as P from '../src/server/public';
import { createVendor, activateSubscription } from '../src/server/vendor';
import { getPool } from '../src/server/db';

let platform: string, owner: any, support: any;
beforeAll(async () => {
  await setupDb(); platform = await mkTenant('Platform', 'platform');
  owner = await mkActor(platform, 'owner@p.test', 'platform_owner'); support = await mkActor(platform, 'support@p.test', 'platform_support');
});
afterAll(closePool);
const good = { name: 'Asha', email: 'asha@example.test', subject: 'Plans', message: 'Do you support A3?', consent: true };

describe('enquiry form', () => {
  it('accepts a valid enquiry, returns a reference, queues an acknowledgement, stores consent version', async () => {
    const r = await P.submitEnquiry(good, '1.1.1.1');
    expect(r.reference).toMatch(/^ENQ-[0-9A-F]{8}$/);
    const row = (await getPool().query('select consent, consent_text_version, status from enquiries where reference=$1', [r.reference])).rows[0];
    expect(row).toEqual({ consent: true, consent_text_version: P.CONSENT_TEXT_VERSION, status: 'new' });
    expect((await getPool().query("select count(*)::int n from email_outbox where to_email='asha@example.test' and template='enquiry_ack'")).rows[0].n).toBe(1);
  });
  it('reports every field error and stores nothing (no consent, bad email, empty, too long)', async () => {
    const n0 = (await getPool().query('select count(*)::int n from enquiries')).rows[0].n;
    const e: any = await P.submitEnquiry({ name: ' ', email: 'nope', subject: '', message: 'x'.repeat(4001), consent: false }, '2.2.2.2').catch(x => x);
    expect(e).toMatchObject({ code: 'validation', status: 422 });
    expect(Object.keys(e.fields).sort()).toEqual(['consent', 'email', 'message', 'name', 'subject']);
    expect((await getPool().query('select count(*)::int n from enquiries')).rows[0].n).toBe(n0);
    await expect(P.submitEnquiry({ ...good, consent: 'yes' }, '2.2.2.2')).rejects.toMatchObject({ code: 'validation' }); // must be literal true
  });
  it('honeypot gets a normal-looking acknowledgement but nothing is stored or emailed', async () => {
    const n0 = (await getPool().query('select count(*)::int n from enquiries')).rows[0].n, m0 = (await getPool().query('select count(*)::int n from email_outbox')).rows[0].n;
    const r = await P.submitEnquiry({ ...good, email: 'bot@example.test', website: 'http://spam' }, '3.3.3.3');
    expect(r.acknowledged).toBe(true);
    expect((await getPool().query('select count(*)::int n from enquiries')).rows[0].n).toBe(n0);
    expect((await getPool().query('select count(*)::int n from email_outbox')).rows[0].n).toBe(m0);
  });
  it('rate limits per source (even under concurrent bursts) and per email', async () => {
    const res = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => P.submitEnquiry({ ...good, email: `burst${i}@example.test` }, '9.9.9.9')));
    expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(P.ENQUIRY_LIMITS.perSourcePerHour);
    for (const r of res) if (r.status === 'rejected') expect(r.reason.code).toBe('rate_limited');
    for (let i = 0; i < 3; i++) await P.submitEnquiry({ ...good, email: 'same@example.test' }, `10.0.0.${i}`);
    await expect(P.submitEnquiry({ ...good, email: 'SAME@example.test' }, '10.0.0.9')).rejects.toMatchObject({ code: 'rate_limited' });
  });
  it('strips control characters and stores only a hash of the source address', async () => {
    const r = await P.submitEnquiry({ ...good, email: 'ctl@example.test', message: 'hi\u0000there\u0007' }, '77.77.77.77');
    const row = (await getPool().query('select message, source_hash from enquiries where reference=$1', [r.reference])).rows[0];
    expect(row.message).toBe('hithere'); expect(row.source_hash).not.toContain('77.77'); expect(row.source_hash).toHaveLength(64);
  });
});

describe('enquiry queue (staff only)', () => {
  it('only platform staff list and update; closing needs a note; closed cannot be closed again; reopening is audited', async () => {
    const T = await mkTenant('V'); const cust = await mkActor(T, 'c@v.test'), vadmin = await mkActor(T, 'va@v.test', 'vendor_admin');
    for (const a of [cust, vadmin]) await expect(P.listEnquiries(a)).rejects.toMatchObject({ code: 'denied' });
    const id = (await getPool().query("select id from enquiries where email='asha@example.test'")).rows[0].id;
    expect((await P.listEnquiries(support, 'new')).length).toBeGreaterThan(0);
    await expect(P.updateEnquiry(cust, id, { status: 'in_progress' })).rejects.toMatchObject({ code: 'denied' });
    await expect(P.updateEnquiry(support, id, { status: 'closed' })).rejects.toMatchObject({ code: 'resolution_required' });
    await P.updateEnquiry(support, id, { status: 'closed', resolution: 'Answered by email' });
    await expect(P.updateEnquiry(support, id, { status: 'closed', resolution: 'again please' })).rejects.toMatchObject({ code: 'invalid_transition' });
    await P.updateEnquiry(owner, id, { status: 'in_progress' });
    expect((await getPool().query('select status, resolution from enquiries where id=$1', [id])).rows[0]).toEqual({ status: 'in_progress', resolution: null });
    expect((await getPool().query("select count(*)::int n from audit_log where action like 'enquiry.%'")).rows[0].n).toBe(2);
  });
});

describe('policies: no application-authored legal text', () => {
  it('returns nothing until an approver supplies text; versions are immutable; latest wins', async () => {
    expect(await P.getPolicy('terms')).toBeNull(); expect(await P.getPolicy('not-a-policy')).toBeNull();
    await expect(P.publishPolicy(support, { slug: 'terms', effectiveDate: '2026-12-01', body: 'x', approvedByName: 'A' })).rejects.toMatchObject({ code: 'denied' });
    await expect(P.publishPolicy(owner, { slug: 'terms', effectiveDate: '2026-12-01', body: 'Text', approvedByName: ' ' })).rejects.toMatchObject({ code: 'approver_required' });
    await expect(P.publishPolicy(owner, { slug: 'terms', effectiveDate: 'soon', body: 'Text', approvedByName: 'Counsel' })).rejects.toMatchObject({ code: 'invalid_date' });
    await P.publishPolicy(owner, { slug: 'terms', effectiveDate: '2026-12-01', body: 'Version one text', approvedByName: 'Counsel' });
    await P.publishPolicy(owner, { slug: 'terms', effectiveDate: '2027-01-01', body: 'Version two text', approvedByName: 'Counsel' });
    expect(await P.getPolicy('terms')).toEqual({ version: 2, effectiveDate: '2027-01-01', body: 'Version two text' });
    await expect(getPool().query("update policies set body='edited'")).rejects.toThrow(/append-only/);
  });
});

describe('public catalogue', () => {
  it('lists latest version of each plan with real prices, cheapest first; none when none exist', async () => {
    const p2 = (await getPool().query("insert into plans(code,version,name,staff_seats,monthly_price_paise) values('test',2,'Test plan v2',20,150000) returning id")).rows[0].id;
    await getPool().query("insert into plans(code,version,name,staff_seats,monthly_price_paise) values('lite',1,'Lite',2,50000)");
    const plans = await P.listPlans();
    expect(plans.map(p => [p.code, p.monthlyPricePaise])).toEqual([['lite', 50000], ['test', 150000]]); expect(plans[1].id).toBe(p2);
  });
  it('direct store: only the platform owner creates one; price shown only once set; slug resolves; one per platform', async () => {
    expect(await P.directPricing()).toBeNull(); expect(await P.directStoreSlug()).toBeNull();
    await expect(P.createDirectStore(support, 'Direct', 'direct-store')).rejects.toMatchObject({ code: 'denied' });
    const { tenantId } = await P.createDirectStore(owner, 'Direct Store', 'direct-store');
    await expect(P.createDirectStore(owner, 'Another', 'another-one')).rejects.toMatchObject({ code: 'exists' });
    expect(await P.directStoreSlug()).toBe('direct-store'); expect(await P.directPricing()).toBeNull();
    await getPool().query('insert into vendor_pricing(tenant_id,per_mp_paise,min_paise) values($1,800,2500)', [tenantId]);
    expect(await P.directPricing()).toEqual({ perMpPaise: 800, minPaise: 2500, slug: 'direct-store' });
  });
  it('vendor registration records a validated plan reference that applies on first activation', async () => {
    await expect(createVendor({ email: 'pv@x.test', password: 'correct-horse-battery', businessName: 'PV', slug: 'pv-shop', planId: '00000000-0000-0000-0000-000000000000' })).rejects.toMatchObject({ code: 'invalid_plan' });
    const lite = (await P.listPlans()).find(p => p.code === 'lite')!;
    await createVendor({ email: 'pv@x.test', password: 'correct-horse-battery', businessName: 'PV', slug: 'pv-shop', planId: lite.id });
    const tid = (await getPool().query("select tenant_id from vendor_profiles where slug='pv-shop'")).rows[0].tenant_id;
    await activateSubscription(tid, testPlanId, 'pv-pay'); // provider event names a different plan id; the chosen plan reference wins
    const used = (await getPool().query('select plan_id from subscription_periods sp join subscriptions s on s.id=sp.subscription_id where s.tenant_id=$1', [tid])).rows[0].plan_id;
    expect(used).toBe(lite.id);
  });
});
