import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupDb, mkTenant, mkBareTenant, mkActor, closePool } from './helpers';
import { adminOverview, jobProblems } from '../src/server/admin';
import { setPlatformPricing, createPlan } from '../src/server/vendor';
import { publishPolicy, createDirectStore, submitEnquiry } from '../src/server/public';
import { getPool } from '../src/server/db';
import sharp from 'sharp';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { fund } from './helpers';

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

describe('job problems list', () => {
  it('is staff-only, shows failed, stuck and waiting jobs by store, and leaks no artwork or contact details', async () => {
    const pool = getPool(); const sup = await mkActor(PT, 'jp-sup@x.test', 'platform_support');
    for (const role of ['customer', 'vendor_admin'] as const) await expect(jobProblems(await mkActor(VT, `jp-${role}@x.test`, role))).rejects.toMatchObject({ status: 403 });
    const mk = async (status: string, extra = '') => {
      const u = await mkActor(VT, `jp-${status}-${Math.random()}@x.test`); const proj = await createProject(u, 'Secret wedding photo');
      const f = await saveOriginal(u, await sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6' } }).png().toBuffer());
      await saveProject(u, proj.id, 1, { sourceFileId: f.fileId, settings: { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' } });
      await fund(VT, u.userId, 100000, 'jc-' + u.userId); await fund(VT, null, 1_000_000, 'jv-' + u.userId);
      const r = await reserveQuote(u, (await createQuote(u, proj.id)).quoteId);
      await pool.query(`update jobs set status=$2${extra ? ', ' + extra : ''} where id=$1`, [r.jobId, status]);
      return r.jobId as string;
    };
    const failedId = await mk('failed', "last_error='render exploded'"); await pool.query("update jobs set finished_at=now(), attempts=3 where id=$1", [failedId]);
    const stuckId = await mk('running'); await pool.query("update jobs set lease_owner='w9', lease_expires_at=now()-interval '5 minutes', attempts=1 where id=$1", [stuckId]);
    await mk('queued');
    const r = await jobProblems(sup);
    expect(r.failed.map((x: any) => x.id)).toContain(failedId); expect(r.failed.find((x: any) => x.id === failedId).last_error).toBe('render exploded');
    expect(r.stuck.map((x: any) => x.id)).toContain(stuckId);
    expect(r.waiting.length).toBeGreaterThan(0);
    expect(r.failed.find((x: any) => x.id === failedId).tenant).toBe('Vendor One');
    expect(JSON.stringify(r)).not.toMatch(/Secret wedding|@x\.test/);
  });
});

describe('audit search', () => {
  it('is staff-only, filters, paginates newest first, audits itself, and hides emails from support', async () => {
    const { searchAudit } = await import('../src/server/admin'); const { audit } = await import('../src/server/identity'); const pool = getPool();
    const owner = await mkActor(PT, 'as-own@x.test', 'platform_owner'); const sup = await mkActor(PT, 'as-sup@x.test', 'platform_support');
    for (const role of ['customer', 'vendor_admin'] as const) await expect(searchAudit(await mkActor(VT, `as-${role}@x.test`, role), {})).rejects.toMatchObject({ status: 403 });
    for (let i = 0; i < 5; i++) await audit(pool, { actor: owner.userId, tenant: VT, action: 'zz.test_event', type: 'thing', id: 'id' + i, outcome: i % 2 ? 'ok' : 'denied' });
    await audit(pool, { actor: owner.userId, tenant: VT, action: 'zzxtest', outcome: 'ok' }); // must not match the escaped prefix "zz.test"
    const all = await searchAudit(owner, { action: 'zz.test' }); expect(all.rows).toHaveLength(5); expect(all.rows.every(r => r.action === 'zz.test_event')).toBe(true);
    expect(all.rows.map(r => r.id)).toEqual([...all.rows.map(r => r.id)].sort((a, b) => b - a));
    expect((await searchAudit(owner, { action: 'zz.test', outcome: 'denied' })).rows).toHaveLength(3);
    expect((await searchAudit(owner, { action: 'zz.test', tenantId: PT })).rows).toHaveLength(0);
    const p1 = await searchAudit(owner, { action: 'zz.test', limit: 2 }); expect(p1.rows).toHaveLength(2); expect(p1.nextBefore).toBeTruthy();
    const p2 = await searchAudit(owner, { action: 'zz.test', limit: 2, before: p1.nextBefore! }); expect(p2.rows).toHaveLength(2); expect(p2.rows[0].id).toBeLessThan(p1.rows[1].id);
    expect(all.rows[0].actor).toBe('as-own@x.test'); expect((await searchAudit(sup, { action: 'zz.test' })).rows[0].actor).toMatch(/^[0-9a-f]{8}$/);
    expect((await searchAudit(owner, { action: 'audit.search' })).rows.length).toBeGreaterThan(0); // searching is recorded
    expect((await searchAudit(owner, { action: 'zz.test', from: '2999-01-01' })).rows).toHaveLength(0);
    await expect(searchAudit(owner, { action: "x'; drop table users; --" })).rejects.toMatchObject({ code: 'invalid_filter' });
    await expect(searchAudit(owner, { tenantId: 'nope' })).rejects.toMatchObject({ code: 'invalid_filter' });
    await expect(searchAudit(owner, { from: 'not a date' })).rejects.toMatchObject({ code: 'invalid_filter' });
  });
});
