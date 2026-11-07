import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupDb, mkTenant, mkBareTenant, mkActor, closePool } from './helpers';
import { adminOverview } from '../src/server/admin';
import { setPlatformPricing, createPlan } from '../src/server/vendor';
import { publishPolicy, createDirectStore, submitEnquiry } from '../src/server/public';
import { getPool } from '../src/server/db';

let PT: string, VT: string;
beforeAll(async () => { await setupDb(); PT = await mkTenant('Platform', 'platform'); VT = await mkTenant('Vendor One'); });
afterAll(closePool);

describe('admin overview', () => {
  it('is staff-only', async () => {
    for (const [t, role] of [[VT, 'customer'], [VT, 'vendor_admin'], [VT, 'vendor_counter']] as const) await expect(adminOverview(await mkActor(t, `x-${role}@x.test`, role))).rejects.toMatchObject({ code: 'denied' });
  });
  it('shows prices, plans, policies, direct store, tenants and enquiry counts; support cannot edit', async () => {
    const owner = await mkActor(PT, 'own@x.test', 'platform_owner'); const sup = await mkActor(PT, 'sup@x.test', 'platform_support');
    await setPlatformPricing(owner, 150, 300); await createPlan(owner, { code: 'pro', name: 'Pro', staffSeats: 5, monthlyPricePaise: 250000 });
    await publishPolicy(owner, { slug: 'terms', effectiveDate: '2026-11-01', body: 'Approved text', approvedByName: 'Client Legal' });
    await createDirectStore(owner, 'Direct', 'direct-shop');
    await submitEnquiry({ name: 'A', email: 'a@x.test', subject: 'Hello', message: 'Hi there', consent: true }, 's1');
    const o = await adminOverview(owner);
    expect(o.canEditSettings).toBe(true); expect(o.processingPrice).toEqual({ perMpPaise: 150, minPaise: 300 });
    expect(o.plans.map(p => p.code)).toEqual(expect.arrayContaining(['pro', 'test']));
    expect(o.policies.find(p => p.slug === 'terms')).toMatchObject({ published: true, version: 1, approvedBy: 'Client Legal' });
    expect(o.policies.find(p => p.slug === 'privacy')!.published).toBe(false); // unpublished is shown honestly
    expect(o.directStore!.slug).toBe('direct-shop'); expect(o.enquiryCounts.new ?? o.enquiryCounts.open).toBeGreaterThanOrEqual(1);
    const v = o.tenants.find(t => t.name === 'Vendor One')!; expect(v).toMatchObject({ kind: 'vendor', status: 'active', subscription: 'active', plan: 'Test plan' });
    expect(JSON.stringify(o)).not.toContain('Approved text'); // policy bodies are not in the overview
    expect((await adminOverview(sup)).canEditSettings).toBe(false);
  });
  it('shows a pending vendor as pending (nothing marks it paid)', async () => {
    const t = await mkBareTenant('Pending V', 'vendor', 'pending'); await getPool().query("insert into subscriptions(tenant_id,status) values($1,'pending')", [t]);
    const o = await adminOverview(await mkActor(PT, 'own2@x.test', 'platform_owner'));
    expect(o.tenants.find(x => x.name === 'Pending V')).toMatchObject({ status: 'pending', subscription: 'pending', plan: null });
  });
});

describe('system health', () => {
  it('staff only; reports queue from the database and storage settings, never secrets', async () => {
    const { systemHealth } = await import('../src/server/admin');
    await expect(systemHealth(await mkActor(VT, 'sh-cust@x.test'))).rejects.toMatchObject({ code: 'denied' });
    const h = await systemHealth(await mkActor(PT, 'sh-staff@x.test', 'platform_owner'));
    expect(h.jobs).toMatchObject({ queued: expect.any(Number), running: expect.any(Number) }); expect(h.storage).toMatchObject({ configured: true, driver: 'local' }); expect(h.redis).toEqual({ configured: false });
    const prev = process.env.APP_ENV; process.env.APP_ENV = 'production'; const bad = await systemHealth(await mkActor(PT, 'sh-staff2@x.test', 'platform_support')); process.env.APP_ENV = prev;
    expect(bad.storage.configured).toBe(false); expect(JSON.stringify(h)).not.toMatch(/S3RVER|secret/i);
  });
});
