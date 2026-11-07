import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkBareTenant, mkActor, fund, closePool, testPlanId } from './helpers';
import * as V from '../src/server/vendor';
import { verifyEmail, invite, acceptInvite } from '../src/server/identity';
import { login, resolveActor } from '../src/server/auth';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { workOnce } from '../src/server/worker';
import { balance } from '../src/server/ledger';
import { getPool } from '../src/server/db';

beforeAll(setupDb); afterAll(closePool);
const PW = 'correct-horse-battery';
const png = () => sharp({ create: { width: 300, height: 200, channels: 3, background: '#2a6' } }).png().toBuffer();
const S = { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' as const };
const tok = async (email: string, tpl: string) => JSON.parse((await getPool().query('select body from email_outbox where to_email=$1 and template=$2 order by id desc limit 1', [email, tpl])).rows[0].body);

describe('vendor onboarding, activation and portal', () => {
  it('registers a pending vendor; portal is hidden until a verified payment activates it', async () => {
    await V.createVendor({ email: 'owner@shop.test', password: PW, businessName: 'Shop One', slug: 'shop-one' });
    await expect(V.getPortal('shop-one')).rejects.toMatchObject({ code: 'not_found' });
    await verifyEmail((await tok('owner@shop.test', 'verify_email')).token);
    const { token } = await login('owner@shop.test', PW);
    await expect(resolveActor(token, undefined)).rejects.toMatchObject({ code: 'denied' }); // pending tenant: no workspace access yet
    const tid = (await getPool().query("select tenant_id from vendor_profiles where slug='shop-one'")).rows[0].tenant_id;
    const r = await V.activateSubscription(tid, testPlanId, 'pay-1');
    expect(r.repeated).toBe(false);
    expect((await V.getPortal('shop-one')).displayName).toBe('Shop One');
    expect(await V.activateSubscription(tid, testPlanId, 'pay-1')).toMatchObject({ repeated: true }); // duplicate event: one period
    expect((await getPool().query('select count(*)::int n from subscription_periods where subscription_id=(select id from subscriptions where tenant_id=$1)', [tid])).rows[0].n).toBe(1);
  });
  it('rejects duplicate slugs, bad slugs and weak passwords; existing emails give the same response', async () => {
    await expect(V.createVendor({ email: 'x@shop.test', password: PW, businessName: 'X', slug: 'shop-one' })).rejects.toMatchObject({ code: 'slug_taken' });
    await expect(V.createVendor({ email: 'x@shop.test', password: PW, businessName: 'X', slug: 'Bad Slug!' })).rejects.toMatchObject({ code: 'invalid_slug' });
    await expect(V.createVendor({ email: 'x@shop.test', password: 'short', businessName: 'X', slug: 'okay-slug' })).rejects.toMatchObject({ code: 'weak_password' });
    expect(await V.createVendor({ email: 'OWNER@shop.test', password: PW, businessName: 'Hijack', slug: 'hijack-try' })).toEqual({ status: 'verification_sent' });
    expect((await getPool().query("select count(*)::int n from vendor_profiles where slug='hijack-try'")).rows[0].n).toBe(0);
  });
  it('only vendor admins edit branding; colour is validated; portal exposes branding only', async () => {
    const T = await mkTenant('Brand'); await getPool().query("insert into vendor_profiles(tenant_id,display_name,slug) values($1,'Brand','brand-co')", [T]);
    const admin = await mkActor(T, 'ba@x.test', 'vendor_admin'), counter = await mkActor(T, 'bc@x.test', 'vendor_counter');
    await expect(V.updateBranding(counter, { displayName: 'Nope' })).rejects.toMatchObject({ code: 'denied' });
    await expect(V.updateBranding(admin, { primaryColour: 'red' })).rejects.toMatchObject({ code: 'invalid_colour' });
    await V.updateBranding(admin, { displayName: 'Brand Co', primaryColour: '#112233' });
    expect(await V.getPortal('brand-co')).toEqual({ tenantId: T, displayName: 'Brand Co', primaryColour: '#112233' });
  });
});

describe('subscription lifecycle (7-day grace, deduplicated reminders)', () => {
  it('renewal extends from period end; reminders at 7d and 1d once; grace after expiry; expired after 7 days; reruns are safe', async () => {
    const T = await mkBareTenant('Life'); await getPool().query("insert into subscriptions(tenant_id,status) values($1,'pending')", [T]);
    await mkActor(T, 'life@x.test', 'vendor_admin');
    const t0 = new Date('2026-01-01T00:00:00Z'); await V.activateSubscription(T, testPlanId, 'life-1', t0);
    const end = new Date(t0.getTime() + 30 * 86400000);
    const at = (ms: number) => new Date(end.getTime() + ms);
    const D = 86400000;
    expect((await V.runSubscriptionLifecycle(at(-10 * D))).reminders).toBe(0);
    expect((await V.runSubscriptionLifecycle(at(-6 * D))).reminders).toBe(1);
    expect((await V.runSubscriptionLifecycle(at(-6 * D))).reminders).toBe(0); // rerun: no duplicate email
    expect((await V.runSubscriptionLifecycle(at(-0.5 * D))).reminders).toBe(1); // 1-day
    expect(await V.runSubscriptionLifecycle(at(1000))).toMatchObject({ toGrace: 1 });
    expect(await V.canProcess(getPool(), T)).toBe(true); // grace still processes
    expect(await V.runSubscriptionLifecycle(at(6 * D))).toMatchObject({ toExpired: 0 });
    expect(await V.runSubscriptionLifecycle(at(7 * D + 1000))).toMatchObject({ toExpired: 1 });
    expect(await V.canProcess(getPool(), T)).toBe(false);
    expect((await getPool().query("select count(*)::int n from email_outbox where to_email='life@x.test' and template like 'subscription_%'")).rows[0].n).toBe(4);
    // renewal after expiry starts now, not from the old end
    const now = at(10 * D); await V.activateSubscription(T, testPlanId, 'life-2', now);
    expect(await V.canProcess(getPool(), T)).toBe(true);
    const p = (await getPool().query("select period_start from subscription_periods where payment_ref='life-2'")).rows[0].period_start;
    expect(new Date(p).getTime()).toBe(now.getTime());
  });
  it('expired vendor cannot start new paid work but can still download existing output', async () => {
    const T = await mkTenant('Exp'); const u = await mkActor(T, 'exp@x.test'); const p = await createProject(u, 'P');
    const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S });
    await fund(T, u.userId, 100000, 'c-exp'); await fund(T, null, 100000, 'v-exp');
    const q1 = await createQuote(u, p.id); const r1 = await reserveQuote(u, q1.quoteId); await workOnce('w');
    await getPool().query("update subscriptions set status='expired' where tenant_id=$1", [T]);
    const q2 = await createQuote(u, p.id);
    await expect(reserveQuote(u, q2.quoteId)).rejects.toMatchObject({ code: 'subscription_inactive' });
    const { readOutput, jobStatus } = await import('../src/server/worker');
    expect((await readOutput(u, (await jobStatus(u, r1.jobId)).outputId!)).buf.length).toBeGreaterThan(0);
  });
  it('scheduled plan change applies at next renewal, not immediately', async () => {
    const T = await mkTenant('Plan'); const admin = await mkActor(T, 'pl@x.test', 'vendor_admin');
    const plan2 = (await getPool().query("insert into plans(code,version,name,staff_seats,monthly_price_paise) values('big',1,'Big',50,1) returning id")).rows[0].id;
    await V.schedulePlanChange(admin, plan2);
    expect((await V.seatsInfo(getPool(), T)).limit).toBe(10);
    await V.activateSubscription(T, testPlanId, 'plan-renew');
    expect((await V.seatsInfo(getPool(), T)).limit).toBe(50);
  });
});

describe('seats and staff roles', () => {
  it('invites respect seat limits (counting pending invites) and acceptance rechecks', async () => {
    const T = await mkBareTenant('Seats'); await getPool().query("insert into subscriptions(tenant_id,status) values($1,'pending')", [T]);
    const plan = (await getPool().query("insert into plans(code,version,name,staff_seats,monthly_price_paise) values('two',1,'Two',2,1) returning id")).rows[0].id;
    await V.activateSubscription(T, plan, 'seat-pay'); const admin = await mkActor(T, 'sa@x.test', 'vendor_admin');
    await invite(admin, 's1@x.test', 'vendor_counter');
    await expect(invite(admin, 's2@x.test', 'vendor_counter')).rejects.toMatchObject({ code: 'no_seats' });
    await acceptInvite((await tok('s1@x.test', 'invite')).token, PW);
    expect((await V.listStaff(admin)).seats).toEqual({ used: 2, limit: 2 });
  });
  it('role changes: admin only, tenant scoped, last admin protected', async () => {
    const T = await mkTenant('Roles'); const admin = await mkActor(T, 'ra@x.test', 'vendor_admin'); const staff = await mkActor(T, 'rs@x.test', 'vendor_counter');
    const id = async (e: string) => (await getPool().query('select m.id from memberships m join users u on u.id=m.user_id where u.email=$1 and m.tenant_id=$2', [e, T])).rows[0].id;
    await expect(V.changeRole(staff, await id('rs@x.test'), 'vendor_admin')).rejects.toMatchObject({ code: 'denied' });
    await V.changeRole(admin, await id('rs@x.test'), 'vendor_finance');
    await expect(V.changeRole(admin, await id('ra@x.test'), 'vendor_counter')).rejects.toMatchObject({ code: 'last_admin' });
    const T2 = await mkTenant('Other'); const other = await mkActor(T2, 'oa@x.test', 'vendor_admin');
    await expect(V.changeRole(other, await id('rs@x.test'), 'vendor_support')).rejects.toMatchObject({ code: 'not_found' });
    await expect(V.changeRole(admin, await id('rs@x.test'), 'platform_owner')).rejects.toMatchObject({ code: 'invalid_role' });
  });
});

describe('pricing', () => {
  it('no hidden defaults: quoting without configured prices is refused', async () => {
    const T = await mkBareTenant('NoPrice'); const u = await mkActor(T, 'np@x.test'); const p = await createProject(u, 'P');
    const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S });
    await expect(createQuote(u, p.id)).rejects.toMatchObject({ code: 'pricing_not_configured' });
  });
  it('quote uses vendor retail price and platform processing price; accepted quotes keep their price when prices change', async () => {
    const T = await mkTenant('Price'); const admin = await mkActor(T, 'pa@x.test', 'vendor_admin'); const u = await mkActor(T, 'pc@x.test');
    await V.setRetailPricing(admin, 1000, 5000); const p = await createProject(u, 'P');
    const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S });
    const q = await createQuote(u, p.id); expect(q.customerAmountPaise).toBe(5000); expect(q.vendorChargePaise).toBeGreaterThanOrEqual(200);
    await V.setRetailPricing(admin, 100000, 90000);
    const row = (await getPool().query('select customer_amount_paise from quotes where id=$1', [q.quoteId])).rows[0];
    expect(Number(row.customer_amount_paise)).toBe(5000);
    await expect(V.setRetailPricing(await mkActor(T, 'pc2@x.test', 'vendor_counter'), 1, 1)).rejects.toMatchObject({ code: 'denied' });
    await expect(V.setRetailPricing(admin, 1.5, 1)).rejects.toMatchObject({ code: 'invalid_price' });
  });
  it('direct channel has no vendor processing charge and needs no vendor credit', async () => {
    const D = await mkTenant('Direct', 'direct'); const u = await mkActor(D, 'dc@x.test'); const p = await createProject(u, 'P');
    const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S });
    const q = await createQuote(u, p.id); expect(q.vendorChargePaise).toBe(0);
    const ca = await fund(D, u.userId, 100000, 'c-direct'); const r = await reserveQuote(u, q.quoteId); await workOnce('w');
    expect((await balance(ca)).settled).toBe(100000 - q.customerAmountPaise);
    expect((await getPool().query("select count(*)::int n from ledger_accounts where tenant_id=$1 and kind='vendor_processing_credit'", [D])).rows[0].n).toBe(0);
    expect(r.jobId).toBeTruthy();
  });
});

describe('counter workflow', () => {
  async function counterQuote(T: string, email: string) {
    const staff = await mkActor(T, email, 'vendor_counter'); const cc = await V.createCounterCustomer(staff, 'Walk-in Ravi');
    const p = await V.createCounterProject(staff, cc.id, 'Flyer');
    const f = await saveOriginal(staff, await png()); await saveProject(staff, p.id, 1, { sourceFileId: f.fileId, settings: S });
    return { staff, q: await createQuote(staff, p.id), cc };
  }
  it('needs recorded payment first; reserves only vendor credit; cash creates no ledger entry or payable; receipt issued', async () => {
    const T = await mkTenant('Counter'); const { staff, q } = await counterQuote(T, 'ct1@x.test'); const va = await fund(T, null, 100000, 'v-ct1');
    await expect(V.reserveCounter(staff, q.quoteId)).rejects.toMatchObject({ code: 'payment_required' });
    await expect(V.recordCounterPayment(staff, q.quoteId, { method: 'cash', amountPaise: q.customerAmountPaise - 1 })).rejects.toMatchObject({ code: 'amount_mismatch' });
    const entriesBefore = (await getPool().query('select count(*)::int n from ledger_entries')).rows[0].n;
    const rc = await V.recordCounterPayment(staff, q.quoteId, { method: 'cash', amountPaise: q.customerAmountPaise });
    expect(rc.receiptNo).toMatch(/^R-\d+$/);
    expect((await V.recordCounterPayment(staff, q.quoteId, { method: 'cash', amountPaise: q.customerAmountPaise })).repeated).toBe(true);
    expect((await getPool().query('select count(*)::int n from ledger_entries')).rows[0].n).toBe(entriesBefore);
    const r = await V.reserveCounter(staff, q.quoteId);
    expect((await balance(va)).held).toBe(q.vendorChargePaise);
    await workOnce('w'); expect((await balance(va)).settled).toBe(100000 - q.vendorChargePaise); // vendor cost captured once
    expect(r.repeated).toBe(false);
  });
  it('online reserve refuses counter quotes; counter reserve refuses other tenants; override needs admin and a reason', async () => {
    const T = await mkTenant('Counter2'); const { staff, q } = await counterQuote(T, 'ct2@x.test'); await fund(T, null, 100000, 'v-ct2');
    await expect(reserveQuote(staff, q.quoteId)).rejects.toMatchObject({ code: 'wrong_channel' });
    const T2 = await mkTenant('Counter3'); const stranger = await mkActor(T2, 'ct3@x.test', 'vendor_counter');
    await expect(V.reserveCounter(stranger, q.quoteId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(V.recordCounterPayment(staff, q.quoteId, { overrideReason: 'free sample for regular' })).rejects.toMatchObject({ code: 'denied' });
    const admin = await mkActor(T, 'ct2a@x.test', 'vendor_admin');
    await expect(V.recordCounterPayment(admin, q.quoteId, { overrideReason: 'ok' })).rejects.toMatchObject({ code: 'reason_required' });
    const r = await V.recordCounterPayment(admin, q.quoteId, { overrideReason: 'Free sample for regular customer' });
    expect(r.receiptNo).toBeTruthy(); expect((await V.reserveCounter(staff, q.quoteId)).jobId).toBeTruthy();
    expect((await getPool().query("select override_by from counter_payments where quote_id=$1", [q.quoteId])).rows[0].override_by).toBe(admin.userId);
  });
  it('vendor credit shortfall blocks counter work', async () => {
    const T = await mkTenant('Counter4'); const { staff, q } = await counterQuote(T, 'ct4@x.test');
    await V.recordCounterPayment(staff, q.quoteId, { method: 'upi_external', amountPaise: q.customerAmountPaise, reference: 'UPI123' });
    await expect(V.reserveCounter(staff, q.quoteId)).rejects.toMatchObject({ code: 'vendor_unavailable' });
  });
  it('counter customer needs a name and stays inside the tenant', async () => {
    const T = await mkTenant('Counter5'); const staff = await mkActor(T, 'ct5@x.test', 'vendor_counter');
    await expect(V.createCounterCustomer(staff, '  ')).rejects.toMatchObject({ code: 'invalid_name' });
    const T2 = await mkTenant('Counter6'); const other = await mkActor(T2, 'ct6@x.test', 'vendor_counter'); const cc = await V.createCounterCustomer(other, 'X');
    await expect(V.createCounterProject(staff, cc.id, 'steal')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('vendor overview', () => {
  it('shows only own-tenant real figures; counter takings labelled as not platform-collected; roles restricted', async () => {
    const T = await mkTenant('Over'); const admin = await mkActor(T, 'oa2@x.test', 'vendor_admin'); await fund(T, null, 5000, 'v-over');
    const T2 = await mkTenant('Over2'); await mkActor(T2, 'o2c@x.test'); await fund(T2, null, 99999, 'v-over2');
    const o = await V.overview(admin);
    expect(o.processingCredit.available).toBe(5000); expect(o.customers).toBe(0); expect(o.subscription?.status).toBe('active');
    expect(o.counterPayments.note).toMatch(/not platform-collected/);
    await expect(V.overview(await mkActor(T, 'oc2@x.test', 'vendor_counter'))).rejects.toMatchObject({ code: 'denied' });
  });
});

describe('customer list (SC-024)', () => {
  it('shows a store only its own people; counter staff see counter records only; search and paging work; no cross-store leak', async () => {
    const V = await import('../src/server/vendor');
    const t1 = await mkTenant('CL One'), t2 = await mkTenant('CL Two');
    const a1 = await mkActor(t1, 'cl-a1@x.test', 'vendor_admin'), c1 = await mkActor(t1, 'cl-c1@x.test', 'vendor_counter'), a2 = await mkActor(t2, 'cl-a2@x.test', 'vendor_admin');
    await mkActor(t1, 'cl-online1@x.test'); await mkActor(t2, 'cl-online2@x.test');
    await V.createCounterCustomer(c1, 'Meena Walkin', '98400 00001'); await V.createCounterCustomer(c1, 'Ravi 100% Sure', 'ravi@x.test'); await V.createCounterCustomer(await mkActor(t2, 'cl-c2@x.test', 'vendor_counter'), 'Other Store Person');
    const all = await V.listCustomers(a1);
    const names = all.rows.map(r => r.name);
    expect(names).toEqual(expect.arrayContaining(['cl-online1@x.test', 'Meena Walkin', 'Ravi 100% Sure']));
    expect(names).not.toContain('cl-online2@x.test'); expect(names).not.toContain('Other Store Person');
    const counter = await V.listCustomers(c1); expect(counter.rows.every(r => r.kind === 'counter')).toBe(true); expect(counter.rows.map(r => r.name)).not.toContain('cl-online1@x.test');
    expect((await V.listCustomers(a1, { q: 'meena' })).rows.map(r => r.name)).toEqual(['Meena Walkin']);
    expect((await V.listCustomers(a1, { q: '100%' })).rows.map(r => r.name)).toEqual(['Ravi 100% Sure']); // % is literal, not a wildcard
    expect((await V.listCustomers(a1, { q: '%' })).rows.map(r => r.name)).toEqual(['Ravi 100% Sure']);
    const p1 = await V.listCustomers(a1, { limit: 2 }); expect(p1.rows).toHaveLength(2); expect(p1.nextCursor).toBeTruthy();
    const p2 = await V.listCustomers(a1, { limit: 2, cursor: p1.nextCursor! }); expect([...p1.rows, ...p2.rows].map(r => r.id)).toEqual(all.rows.slice(0, p1.rows.length + p2.rows.length).map(r => r.id));
    expect((await V.listCustomers(a2)).rows.map(r => r.name)).toEqual(expect.arrayContaining(['cl-online2@x.test', 'Other Store Person']));
    await expect(V.listCustomers(await mkActor(t1, 'cl-cust@x.test'))).rejects.toMatchObject({ status: 403 });
    await expect(V.listCustomers(a1, { cursor: 'bad' })).rejects.toMatchObject({ code: 'invalid_filter' });
  });
});
