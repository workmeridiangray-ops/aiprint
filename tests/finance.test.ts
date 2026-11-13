import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkBareTenant, mkActor, fund, closePool, testPlanId } from './helpers';
import { getPool } from '../src/server/db';
import { balance, ensureAccount } from '../src/server/ledger';
import * as P from '../src/server/payments';
import * as R from '../src/server/refunds';
import * as S from '../src/server/settlements';
import { sandbox, signSandboxEvent, getProvider, type ProviderEvent } from '../src/server/providers';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { workOnce, readOutput } from '../src/server/worker';
import { createVendor } from '../src/server/vendor';
import { verifyEmail } from '../src/server/identity';
import { login, resolveActor, type Actor } from '../src/server/auth';

let PT = '', owner: Actor, fin1: Actor, fin2: Actor;
beforeAll(async () => {
  await setupDb(); process.env.PAYMENT_PROVIDER = 'sandbox'; delete process.env.SETTLEMENT_MODE;
  PT = await mkTenant('Platform', 'platform');
  owner = await mkActor(PT, 'own@fin.test', 'platform_owner'); fin1 = await mkActor(PT, 'f1@fin.test', 'platform_finance'); fin2 = await mkActor(PT, 'f2@fin.test', 'platform_finance');
});
afterAll(closePool);
beforeEach(() => { sandbox.nextRefund = null; sandbox.nextTransfer = null; });

const png = () => sharp({ create: { width: 300, height: 200, channels: 3, background: '#2a6' } }).png().toBuffer();
const SET = { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' as const };
const ev = (p: { paymentId: string; orderId: string; amountPaise: number }, over: Partial<ProviderEvent> = {}): ProviderEvent => ({ eventId: 'evt_' + p.paymentId, kind: 'payment_success', orderId: p.orderId, paymentId: 'pay_' + p.paymentId, amountPaise: p.amountPaise, currency: 'INR', ...over });
const hook = (e: ProviderEvent) => { const s = signSandboxEvent(e); return P.handleWebhook('sandbox', s.body, s.signature, null); };
const count = async (sql: string, a: unknown[] = []) => Number((await getPool().query(sql, a)).rows[0].n);
/** A customer in a vendor store pays by top-up and gets one finished job (customer charge 1000 paise, vendor processing 200 paise). */
async function paidJob(T: string, email: string) {
  const u = await mkActor(T, email); await fund(T, null, 5000, 'vfund-' + email);
  const pay = await P.createPayment(u, { purpose: 'customer_topup', amountPaise: 20000 }); await hook(ev(pay));
  const p = await createProject(u, 'P'); const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: SET });
  const q = await createQuote(u, p.id); const r = await reserveQuote(u, q.quoteId); await workOnce('w-' + email);
  const out = (await getPool().query('select id from outputs where job_id=$1', [r.jobId])).rows[0].id as string;
  return { u, jobId: r.jobId, outputId: out, payment: pay, acc: await ensureAccount(getPool(), T, 'customer_service_credit', u.userId), payable: await ensureAccount(getPool(), T, 'vendor_payable', null), charge: q.customerAmountPaise };
}

describe('payments: nothing is credited without a verified provider record', () => {
  it('fails closed when no provider is configured, and refuses the sandbox outside development and tests', async () => {
    const T = await mkTenant('NoProv'); const u = await mkActor(T, 'np@pay.test');
    process.env.PAYMENT_PROVIDER = '';
    await expect(P.createPayment(u, { purpose: 'customer_topup', amountPaise: 20000 })).rejects.toMatchObject({ code: 'provider_unconfigured', status: 503 });
    process.env.PAYMENT_PROVIDER = 'sandbox'; process.env.APP_ENV = 'production';
    expect(() => getProvider()).toThrow(/cannot be used/);
    process.env.APP_ENV = 'test';
    expect(await count('select count(*)::int n from payments where tenant_id=$1', [T])).toBe(0);
  });
  it('creating a payment credits nothing; a signed success event credits once; duplicates and repeats change nothing (AT-09, AT-12)', async () => {
    const T = await mkTenant('Pay1'); const u = await mkActor(T, 'c@pay1.test');
    const pay = await P.createPayment(u, { purpose: 'customer_topup', amountPaise: 50000 });
    const acc = await ensureAccount(getPool(), T, 'customer_service_credit', u.userId);
    expect((await balance(acc)).available).toBe(0);
    expect((await P.getPayment(u, pay.paymentId)).status).toBe('pending'); // the browser "returning" proves nothing
    expect((await hook(ev(pay))).outcome).toBe('success');
    expect((await hook(ev(pay))).outcome).toBe('duplicate');
    expect((await hook(ev(pay, { eventId: 'evt_other_' + pay.paymentId }))).outcome).toBe('already_success'); // a second event about the same money
    await P.syncPayment(pay.paymentId);
    expect((await balance(acc)).available).toBe(50000);
    expect(await count("select count(*)::int n from ledger_entries where account_id=$1", [acc])).toBe(1);
  });
  it('rejects a forged signature and an event for another provider', async () => {
    const T = await mkTenant('Pay2'); const u = await mkActor(T, 'c@pay2.test'); const pay = await P.createPayment(u, { purpose: 'customer_topup', amountPaise: 10000 });
    await expect(P.handleWebhook('sandbox', JSON.stringify(ev(pay)), 'deadbeef', null)).rejects.toMatchObject({ code: 'bad_signature' });
    const s = signSandboxEvent(ev(pay)); await expect(P.handleWebhook('razorpay', s.body, s.signature, null)).rejects.toMatchObject({ code: 'not_found' });
    expect((await P.getPayment(u, pay.paymentId)).status).toBe('pending');
  });
  it('quarantines a wrong amount or currency and opens an exception instead of crediting', async () => {
    const T = await mkTenant('Pay3'); const u = await mkActor(T, 'c@pay3.test'); const pay = await P.createPayment(u, { purpose: 'customer_topup', amountPaise: 10000 });
    expect((await hook(ev(pay, { amountPaise: 100 }))).outcome).toBe('quarantined');
    const acc = await ensureAccount(getPool(), T, 'customer_service_credit', u.userId);
    expect((await balance(acc)).available).toBe(0);
    expect(await count("select count(*)::int n from finance_exceptions where payment_id=$1 and kind='amount_mismatch'", [pay.paymentId])).toBe(1);
    expect((await hook(ev(pay, { eventId: 'late-correct' }))).outcome).toBe('quarantined'); // stays with finance; never auto-credited afterwards
    expect((await balance(acc)).available).toBe(0);
  });
  it('browser closed: the scheduled check finds the payment at the provider; an expired payment that succeeds late is still credited once', async () => {
    const T = await mkTenant('Pay4'); const u = await mkActor(T, 'c@pay4.test'); const acc = await ensureAccount(getPool(), T, 'customer_service_credit', u.userId);
    const a = await P.createPayment(u, { purpose: 'customer_topup', amountPaise: 10000 });
    sandbox.orders.set(a.orderId, { status: 'paid', paymentId: 'pay_a', amountPaise: 10000, currency: 'INR' }); // paid at the provider, no webhook arrived
    const b = await P.createPayment(u, { purpose: 'customer_topup', amountPaise: 20000 });
    await getPool().query("update payments set created_at = now() - interval '2 hours' where id=$1", [b.paymentId]);
    const r1 = await P.reconcilePayments();
    expect(r1).toMatchObject({ succeeded: 1, expired: 1 });
    expect((await P.getPayment(u, b.paymentId)).status).toBe('expired');
    expect((await hook(ev(b))).outcome).toBe('success'); // late success after local expiry
    await P.reconcilePayments();
    expect((await balance(acc)).available).toBe(30000);
  });
  it('an unknown order reported as paid credits nobody and is raised to finance', async () => {
    expect((await hook({ eventId: 'ghost-1', kind: 'payment_success', orderId: 'sbx_order_ghost', paymentId: 'pay_ghost', amountPaise: 5000, currency: 'INR' })).outcome).toBe('unmatched');
    expect(await count("select count(*)::int n from finance_exceptions where kind='unmatched_payment'")).toBe(1);
  });
  it('enforces who may pay for what, and the amount limits', async () => {
    const T = await mkTenant('Pay5'); const cust = await mkActor(T, 'c@pay5.test'); const counter = await mkActor(T, 'k@pay5.test', 'vendor_counter'); const admin = await mkActor(T, 'a@pay5.test', 'vendor_admin');
    await expect(P.createPayment(cust, { purpose: 'customer_topup', amountPaise: 5000 })).rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(P.createPayment(cust, { purpose: 'customer_topup', amountPaise: 1000100 })).rejects.toMatchObject({ code: 'invalid_amount' });
    await expect(P.createPayment(cust, { purpose: 'vendor_topup', amountPaise: 20000 })).rejects.toMatchObject({ code: 'denied' });
    await expect(P.createPayment(counter, { purpose: 'vendor_topup', amountPaise: 20000 })).rejects.toMatchObject({ code: 'denied' });
    const v = await P.createPayment(admin, { purpose: 'vendor_topup', amountPaise: 20000 }); await hook(ev(v));
    expect((await balance(await ensureAccount(getPool(), T, 'vendor_processing_credit', null))).available).toBe(20000);
    const other = await mkActor(await mkTenant('Pay5b'), 'c@pay5b.test');
    await expect(P.getPayment(other, v.paymentId)).rejects.toMatchObject({ code: 'not_found' });
    await expect(P.sandboxComplete(other, v.paymentId, 'success')).rejects.toMatchObject({ code: 'not_found' });
  });
  it('a pending store can sign in, pay its subscription and becomes active only from the verified payment; the price is read on the server', async () => {
    await createVendor({ email: 'boss@newshop.test', password: 'correct-horse-battery', businessName: 'New Shop', slug: 'new-shop', planId: testPlanId });
    const tok = JSON.parse((await getPool().query("select body from email_outbox where to_email='boss@newshop.test' and template='verify_email'")).rows[0].body).token;
    await verifyEmail(tok); const { token } = await login('boss@newshop.test', 'correct-horse-battery'); const admin = await resolveActor(token, undefined);
    const tenant = async () => (await getPool().query('select status from tenants where id=$1', [admin.tenantId])).rows[0].status;
    expect(await tenant()).toBe('pending');
    const pay = await P.createPayment(admin, { purpose: 'subscription', planId: testPlanId, amountPaise: 1 }); // the browser's amount is ignored
    expect(pay.amountPaise).toBe(100000);
    expect((await P.subscriptionInfo(admin) as any).status).toBe('pending');
    await hook(ev(pay));
    expect(await tenant()).toBe('active');
    expect((await P.subscriptionInfo(admin) as any).status).toBe('active');
    await hook(ev(pay, { eventId: 'again' })); await P.reconcilePayments();
    expect(await count('select count(*)::int n from subscription_periods sp join subscriptions s on s.id=sp.subscription_id where s.tenant_id=$1', [admin.tenantId])).toBe(1);
  });
  it('an organisation member cannot top up shared credit; the administrator can', async () => {
    const T = await mkTenant('PayOrg'); const adm = await mkActor(T, 'oa@payorg.test'); const mem = await mkActor(T, 'om@payorg.test');
    const org = (await getPool().query("insert into organisations(tenant_id,name,created_by) values($1,'Org',$2) returning id", [T, adm.userId])).rows[0].id;
    await getPool().query("insert into org_members(org_id,user_id,role) values($1,$2,'admin'),($1,$3,'member')", [org, adm.userId, mem.userId]);
    await expect(P.createPayment(mem, { purpose: 'org_topup', amountPaise: 20000, orgId: org })).rejects.toMatchObject({ code: 'not_found' });
    const pay = await P.createPayment(adm, { purpose: 'org_topup', amountPaise: 20000, orgId: org }); await hook(ev(pay));
    const m = await P.myMoney(adm); expect(m.accounts.find(a => a.kind === 'org')!.availablePaise).toBe(20000); expect(m.accounts.find(a => a.kind === 'customer')!.availablePaise).toBe(0);
  });
});

describe('sales, vendor payable and what finance can see', () => {
  it('an online sale adds the gross retail amount to vendor payable; processing is not deducted again; the direct store creates no payable (AT-14)', async () => {
    const T = await mkTenant('Sale1'); const j = await paidJob(T, 'c@sale1.test');
    expect(j.charge).toBe(1000);
    expect((await balance(j.payable)).settled).toBe(1000);
    expect((await balance(await ensureAccount(getPool(), T, 'vendor_processing_credit', null))).settled).toBe(5000 - 200);
    expect((await balance(j.acc)).settled).toBe(20000 - 1000);
    const D = await mkTenant('DirectS', 'direct'); const u = await mkActor(D, 'c@directs.test'); await fund(D, u.userId, 5000, 'd-fund');
    const p = await createProject(u, 'P'); const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: SET });
    const q = await createQuote(u, p.id); await reserveQuote(u, q.quoteId); await workOnce('w-direct');
    expect(await count("select count(*)::int n from ledger_accounts where tenant_id=$1 and kind='vendor_payable'", [D])).toBe(0);
  });
  it('finance sees ledgers and totals but not artwork; other roles see none of it (AT-03)', async () => {
    const T = await mkTenant('Sale2'); const j = await paidJob(T, 'c@sale2.test');
    const t = await P.financeTotals(fin1); expect(t.vendorPayablePaise).toBeGreaterThanOrEqual(1000); expect(t.processingRevenuePaise).toBeGreaterThanOrEqual(200);
    const led = await P.listLedgers(fin1, { kind: 'vendor_payable' }); expect(led.some(l => l.tenantId === T && l.settledPaise === 1000)).toBe(true);
    expect((await P.ledgerEntries(fin1, j.payable))[0]).toMatchObject({ amountPaise: 1000, reason: 'sale_earned' });
    await expect(readOutput(fin1, j.outputId)).rejects.toMatchObject({ code: 'not_found' }); // finance has no file access
    const sup = await mkActor(PT, 'sup@fin.test', 'platform_support'); const vadm = await mkActor(T, 'a@sale2.test', 'vendor_admin');
    for (const a of [sup, vadm, j.u]) { await expect(P.listLedgers(a)).rejects.toMatchObject({ code: 'denied' }); await expect(P.listPayments(a)).rejects.toMatchObject({ code: 'denied' }); }
    const mine = await P.myMoney(j.u); expect(JSON.stringify(mine)).not.toMatch(/vendor_processing|payable/); // customer never sees store cost or margin
  });
});

describe('refunds: store approves, finance executes, value comes back once (AT-16)', () => {
  it('partial then full: ceiling enforced, access kept after partial and revoked after full, payable reduced, processing cost not restored', async () => {
    const T = await mkTenant('Ref1'); const j = await paidJob(T, 'c@ref1.test'); const vadm = await mkActor(T, 'a@ref1.test', 'vendor_admin');
    const vendCredit = await ensureAccount(getPool(), T, 'vendor_processing_credit', null); const before = (await balance(vendCredit)).settled;
    await expect(R.requestRefund(j.u, { kind: 'job_charge', jobId: j.jobId, amountPaise: 1001, reason: 'Too much asked for here' })).rejects.toMatchObject({ code: 'over_refund' });
    const r1 = await R.requestRefund(j.u, { kind: 'job_charge', jobId: j.jobId, amountPaise: 400, reason: 'Colours were not as expected', revokeAccess: true });
    await expect(R.requestRefund(j.u, { kind: 'job_charge', jobId: j.jobId, amountPaise: 601, reason: 'Second request over the limit' })).rejects.toMatchObject({ code: 'over_refund' });
    await expect(R.executeRefund(fin1, r1.id)).rejects.toMatchObject({ code: 'invalid_transition' }); // not approved yet
    await expect(R.decideRefund(j.u, r1.id, true)).rejects.toMatchObject({ code: 'not_found' }); // a customer cannot approve
    await expect(R.decideRefund(fin1, r1.id, true)).rejects.toMatchObject({ code: 'not_found' }); // nor can platform finance: it is the store's decision
    await R.decideRefund(vadm, r1.id, true);
    expect((await balance(j.acc)).settled).toBe(19000); // approval alone returns nothing
    expect((await R.executeRefund(fin1, r1.id)).status).toBe('confirmed');
    expect((await balance(j.acc)).settled).toBe(19400);
    expect((await balance(j.payable)).settled).toBe(600);
    await readOutput(j.u, j.outputId); // partial refund: the customer could not ask for revocation, so access stays
    await expect(R.executeRefund(fin2, r1.id)).rejects.toMatchObject({ code: 'invalid_transition' }); // no second execution
    const r2 = await R.requestRefund(vadm, { kind: 'job_charge', jobId: j.jobId, amountPaise: 600, reason: 'Refunding the remainder too' });
    await R.decideRefund(vadm, r2.id, true); await R.executeRefund(fin2, r2.id);
    expect((await balance(j.acc)).settled).toBe(20000); expect((await balance(j.payable)).settled).toBe(0);
    await expect(readOutput(j.u, j.outputId)).rejects.toMatchObject({ code: 'removed' }); // fully refunded: no further downloads
    expect((await balance(vendCredit)).settled).toBe(before); // the store's processing cost is a separate correction
    await expect(R.requestRefund(j.u, { kind: 'job_charge', jobId: j.jobId, amountPaise: 1, reason: 'Nothing is left to refund' })).rejects.toMatchObject({ code: 'over_refund' });
  });
  it('back to the bank: no credit is added as well, an unknown provider answer is held for reconciliation and never sent twice', async () => {
    const T = await mkTenant('Ref2'); const j = await paidJob(T, 'c@ref2.test'); const vadm = await mkActor(T, 'a@ref2.test', 'vendor_admin');
    const r = await R.requestRefund(j.u, { kind: 'job_charge', jobId: j.jobId, amountPaise: 1000, reason: 'Please return it to my card', method: 'provider' });
    await R.decideRefund(vadm, r.id, true); sandbox.nextRefund = 'unknown';
    expect((await R.executeRefund(fin1, r.id)).status).toBe('unknown');
    expect((await balance(j.acc)).settled).toBe(19000); expect((await balance(j.payable)).settled).toBe(1000); await readOutput(j.u, j.outputId); // nothing applied yet
    expect(await count("select count(*)::int n from finance_exceptions where kind='refund_unknown' and tenant_id=$1", [T])).toBe(1);
    await expect(R.executeRefund(fin1, r.id)).rejects.toMatchObject({ code: 'invalid_transition' });
    sandbox.refunds.set('refund:' + r.id, { id: 'sbx_rf_x', status: 'confirmed' }); // the provider did process it
    expect((await R.reconcileRefunds()).settled).toBe(1); await R.reconcileRefunds();
    expect((await balance(j.acc)).settled).toBe(19000); // money went to the bank, so no credit as well
    expect((await balance(j.payable)).settled).toBe(0);
    await expect(readOutput(j.u, j.outputId)).rejects.toMatchObject({ code: 'removed' });
  });
  it('a provider refusal leaves everything as it was and is raised to finance; counter and unpaid jobs are not refundable here', async () => {
    const T = await mkTenant('Ref3'); const j = await paidJob(T, 'c@ref3.test'); const vadm = await mkActor(T, 'a@ref3.test', 'vendor_admin');
    const r = await R.requestRefund(j.u, { kind: 'job_charge', jobId: j.jobId, amountPaise: 500, reason: 'Refund me to the bank please', method: 'provider' });
    await R.decideRefund(vadm, r.id, true); sandbox.nextRefund = 'failed';
    expect((await R.executeRefund(fin1, r.id)).status).toBe('failed');
    expect((await balance(j.payable)).settled).toBe(1000); expect(await count("select count(*)::int n from finance_exceptions where kind='refund_failed' and tenant_id=$1", [T])).toBe(1);
    const other = await mkActor(await mkTenant('Ref3b'), 'c@ref3b.test');
    await expect(R.requestRefund(other, { kind: 'job_charge', jobId: j.jobId, amountPaise: 100, reason: 'Trying another tenant job' })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('unused credit: only what is unused, taken out of circulation on approval, restored if the provider refuses; approver cannot execute (AT-25)', async () => {
    const T = await mkTenant('Ref4'); const j = await paidJob(T, 'c@ref4.test'); // 20000 paid, 1000 spent
    await expect(R.requestRefund(j.u, { kind: 'unused_credit', paymentId: j.payment.paymentId, amountPaise: 19001, reason: 'More than is unused' })).rejects.toMatchObject({ code: 'over_refund' });
    const r = await R.requestRefund(j.u, { kind: 'unused_credit', paymentId: j.payment.paymentId, amountPaise: 19000, reason: 'I no longer need this credit' });
    await expect(R.requestRefund(j.u, { kind: 'unused_credit', paymentId: j.payment.paymentId, amountPaise: 1, reason: 'A second overlapping ask' })).rejects.toMatchObject({ code: 'over_refund' });
    await R.decideRefund(fin1, r.id, true);
    expect((await balance(j.acc)).available).toBe(0); // cannot be spent while it is on its way back
    await expect(R.executeRefund(fin1, r.id)).rejects.toMatchObject({ code: 'self_approval' });
    sandbox.nextRefund = 'failed'; expect((await R.executeRefund(fin2, r.id)).status).toBe('failed');
    expect((await balance(j.acc)).available).toBe(19000);
    const r2 = await R.requestRefund(j.u, { kind: 'unused_credit', paymentId: j.payment.paymentId, amountPaise: 19000, reason: 'Trying the return again' });
    await R.decideRefund(owner, r2.id, true); expect((await R.executeRefund(fin2, r2.id)).status).toBe('confirmed');
    expect((await balance(j.acc)).settled).toBe(0);
  });
});

describe('credit adjustments need two people and post once (AT-25)', () => {
  it('self-approval refused; approval posts one entry; a negative correction cannot exceed the balance', async () => {
    const T = await mkTenant('Adj1'); const acc = await fund(T, null, 1000, 'adj-seed');
    const a = await R.proposeAdjustment(fin1, { accountId: acc, amountPaise: 500, reason: 'Goodwill for failed batch', evidence: 'Ticket SUP-12' });
    await expect(R.decideAdjustment(fin1, a.id, true)).rejects.toMatchObject({ code: 'self_approval' });
    await expect(R.proposeAdjustment(await mkActor(T, 'va@adj1.test', 'vendor_admin'), { accountId: acc, amountPaise: 500, reason: 'Minting my own credit', evidence: 'none' })).rejects.toMatchObject({ code: 'denied' });
    await R.decideAdjustment(fin2, a.id, true); await expect(R.decideAdjustment(owner, a.id, true)).rejects.toMatchObject({ code: 'invalid_transition' });
    expect((await balance(acc)).settled).toBe(1500);
    const b = await R.proposeAdjustment(fin2, { accountId: acc, amountPaise: -2000, reason: 'Reversal larger than balance', evidence: 'FX-1' });
    await expect(R.decideAdjustment(fin1, b.id, true)).rejects.toMatchObject({ code: 'insufficient_balance' });
    await expect(getPool().query('update ledger_entries set amount_paise=1 where account_id=$1', [acc])).rejects.toThrow(/append-only/);
  });
});

describe('beneficiaries and settlement runs (AT-17, AT-18)', () => {
  const ben = async (admin: Actor, acct = '123456789012') => { const b = await S.requestBeneficiary(admin, { holderName: 'Shop Pvt Ltd', accountNumber: acct, ifsc: 'HDFC0001234', reason: 'First payout account' }); return b; };
  const approveBen = async (id: string) => S.decideBeneficiary(fin2, id, true);
  const lastMonth = () => { const d = new Date(Date.now() + 5.5 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
  const backdate = async (T: string) => { const c = await getPool().connect(); try { await c.query('alter table ledger_entries disable trigger ledger_entries_immutable'); await c.query("update ledger_entries set created_at = now() - interval '40 days' where $1::uuid is not null", [T]); await c.query('alter table ledger_entries enable trigger ledger_entries_immutable'); } finally { c.release(); } };

  it('stores only the last four digits; requester and verifier cannot approve; approval retires the old destination', async () => {
    const T = await mkTenant('Ben1'); const vadm = await mkActor(T, 'a@ben1.test', 'vendor_admin'); const counter = await mkActor(T, 'k@ben1.test', 'vendor_counter');
    await expect(S.requestBeneficiary(counter, { holderName: 'X Y', accountNumber: '123456789012', ifsc: 'HDFC0001234', reason: 'Counter staff trying' })).rejects.toMatchObject({ code: 'denied' });
    await expect(S.requestBeneficiary(vadm, { holderName: 'X Y', accountNumber: '12ab', ifsc: 'HDFC0001234', reason: 'Bad account number' })).rejects.toMatchObject({ code: 'invalid_account' });
    const b = await ben(vadm, '998877665544'); expect(b.status).toBe('verified');
    const dump = JSON.stringify((await getPool().query('select * from beneficiaries where id=$1', [b.id])).rows[0]); expect(dump).not.toContain('998877665544'); expect(dump).toContain('5544');
    expect(JSON.stringify(await S.myBeneficiaries(vadm))).toContain('•••• 5544');
    const unverified = await ben(vadm, '111122220000'); expect(unverified.status).toBe('requested'); // provider could not verify
    await expect(S.decideBeneficiary(fin2, unverified.id, true)).rejects.toMatchObject({ code: 'not_verified' });
    await S.verifyBeneficiary(fin1, unverified.id, 'Cancelled cheque checked 12 Nov');
    await expect(S.decideBeneficiary(fin1, unverified.id, true)).rejects.toMatchObject({ code: 'self_approval' });
    await S.decideBeneficiary(fin2, unverified.id, true);
    const next = await ben(vadm, '555566667777'); await approveBen(next.id);
    expect(await count("select count(*)::int n from beneficiaries where tenant_id=$1 and status='approved'", [T])).toBe(1);
  });
  it('statement arithmetic, separate approval, one transfer per line, payable cleared once', async () => {
    const T = await mkTenant('Set1'); const j = await paidJob(T, 'c@set1.test'); const vadm = await mkActor(T, 'a@set1.test', 'vendor_admin');
    await approveBen((await ben(vadm)).id); await backdate(T);
    const period = lastMonth();
    await expect(S.prepareRun(fin1, new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7))).rejects.toMatchObject({ code: 'period_open' });
    await getPool().query("delete from settlement_lines; delete from settlement_runs");
    const run = await S.prepareRun(fin1, period);
    const d = await S.runDetail(fin1, run.id); const line = d.lines.find(l => l.tenant === 'Set1')!;
    expect(line).toMatchObject({ payablePaise: 1000, transferPaise: 1000, status: 'pending' });
    await expect(S.approveRun(fin1, run.id)).rejects.toMatchObject({ code: 'self_approval' });
    await expect(S.initiateRun(fin1, run.id)).rejects.toMatchObject({ code: 'invalid_transition' });
    await S.approveRun(fin2, run.id);
    sandbox.transferCalls = 0; const done = await S.initiateRun(fin1, run.id);
    expect(done.lines.find(l => l.tenant === 'Set1')!.status).toBe('confirmed');
    expect((await balance(j.payable)).settled).toBe(0);
    await expect(S.initiateRun(fin1, run.id)).rejects.toMatchObject({ code: 'invalid_transition' }); // completed
    await expect(S.prepareRun(fin1, period)).rejects.toMatchObject({ code: 'invalid_transition' });
    const st = await S.vendorStatement(vadm); expect(st.balancePaise).toBe(0); expect(st.settlements[0]).toMatchObject({ transferPaise: 1000, status: 'confirmed' });
    // a refund after the payout: recorded as a negative balance carried forward, no bank debit
    const r = await R.requestRefund(j.u, { kind: 'job_charge', jobId: j.jobId, amountPaise: 1000, reason: 'Late complaint after settlement' }); await R.decideRefund(vadm, r.id, true); await R.executeRefund(fin1, r.id);
    expect((await S.vendorStatement(vadm)).balancePaise).toBe(-1000);
  });
  it('a change after approval cancels the approval; unknown transfers are never retried until reconciled; confirmed failures can be retried once', async () => {
    const T = await mkTenant('Set2'); const j = await paidJob(T, 'c@set2.test'); const vadm = await mkActor(T, 'a@set2.test', 'vendor_admin');
    await approveBen((await ben(vadm)).id); await backdate(T);
    await getPool().query("delete from settlement_lines; delete from settlement_runs");
    const period = lastMonth(); const run = await S.prepareRun(fin1, period); await S.approveRun(fin2, run.id);
    // the store changes its bank account after approval
    await approveBen((await ben(vadm, '444433332222')).id);
    await expect(S.initiateRun(fin1, run.id)).rejects.toMatchObject({ code: 'run_stale' });
    expect((await S.runDetail(fin1, run.id)).status).toBe('draft');
    await expect(S.approveRun(fin2, run.id)).rejects.toMatchObject({ code: 'run_stale' });
    expect((await S.prepareRun(fin1, period)).changed).toBe(true); await S.approveRun(fin2, run.id);
    sandbox.nextTransfer = 'unknown'; sandbox.transferCalls = 0;
    let d = await S.initiateRun(fin1, run.id); const line = d.lines.find(l => l.tenant === 'Set2')!;
    expect(line.status).toBe('unknown'); expect((await balance(j.payable)).settled).toBe(1000);
    d = await S.initiateRun(fin1, run.id); expect(sandbox.transferCalls).toBe(1); // blocked: not sent again
    expect(d.lines.find(l => l.tenant === 'Set2')!.status).toBe('unknown');
    sandbox.transfers.set(`settle:${line.id}:1`, { id: 'sbx_tr_f', status: 'failed', note: 'Account closed' });
    expect((await S.reconcileTransfers()).settled).toBe(1);
    d = await S.initiateRun(fin1, run.id); expect(sandbox.transferCalls).toBe(2); // a new attempt only after a confirmed failure
    expect(d.lines.find(l => l.tenant === 'Set2')!.status).toBe('confirmed'); expect(d.status).toBe('completed');
    expect((await balance(j.payable)).settled).toBe(0);
    expect(await count("select count(*)::int n from ledger_entries where account_id=$1 and reason='payout'", [j.payable])).toBe(1);
  });
  it('holds a store with no approved destination or an open exception; other roles cannot see or run settlements; manual recording is off unless elected', async () => {
    const T = await mkTenant('Set3'); const j = await paidJob(T, 'c@set3.test'); const vadm = await mkActor(T, 'a@set3.test', 'vendor_admin'); await backdate(T);
    await getPool().query("delete from settlement_lines; delete from settlement_runs");
    const run = await S.prepareRun(fin1, lastMonth()); const line = (await S.runDetail(fin1, run.id)).lines.find(l => l.tenant === 'Set3')!;
    expect(line).toMatchObject({ status: 'held', transferPaise: 0, holdReason: 'No approved payout destination' });
    for (const a of [vadm, j.u, await mkActor(PT, 'sup2@fin.test', 'platform_support')]) { await expect(S.listRuns(a)).rejects.toMatchObject({ code: 'denied' }); await expect(S.prepareRun(a, lastMonth())).rejects.toMatchObject({ code: 'denied' }); }
    await expect(S.recordManualTransfer(fin1, line.id, 'UTR123456')).rejects.toMatchObject({ code: 'not_manual' });
    await expect(S.vendorStatement(j.u)).rejects.toMatchObject({ code: 'denied' });
  });
});

describe('finance exceptions close only with evidence', () => {
  it('take, plan, resolve with evidence; a resolved exception cannot be reopened by editing', async () => {
    await P.raiseException(getPool(), { kind: 'test', dedupeKey: 'test-x1', detail: 'Something to look at' }); await P.raiseException(getPool(), { kind: 'test', dedupeKey: 'test-x1', detail: 'Duplicate raise' });
    const x = (await P.listExceptions(fin1)).find(e => e.kind === 'test')!; expect((await P.listExceptions(fin1)).filter(e => e.kind === 'test').length).toBe(1);
    await P.updateException(fin1, x.id, { action: 'take' });
    await expect(P.updateException(fin1, x.id, { action: 'resolve', resolution: 'done', evidence: '' })).rejects.toMatchObject({ code: 'evidence_required' });
    await P.updateException(fin1, x.id, { action: 'resolve', resolution: 'Matched to provider record and credited', evidence: 'Provider ref pay_123' });
    await expect(P.updateException(fin1, x.id, { action: 'take' })).rejects.toMatchObject({ code: 'invalid_transition' });
    await expect(P.listExceptions(await mkActor(PT, 'sup3@fin.test', 'platform_support'))).rejects.toMatchObject({ code: 'denied' });
  });
});
