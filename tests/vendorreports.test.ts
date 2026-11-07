import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import * as V from '../src/server/vendor';
import * as R from '../src/server/vendorreports';
import { saveOriginal } from '../src/server/files';
import { saveProject, createProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { workOnce } from '../src/server/worker';
import { getPool } from '../src/server/db';

beforeAll(setupDb); afterAll(closePool);
const S = { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 150, fit: 'fill' as const, format: 'png' as const };
const png = () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6' } }).png().toBuffer();

async function store(name: string, tag: string) {
  const T = await mkTenant(name); await fund(T, null, 1_000_000, `vr-v-${tag}`);
  const admin = await mkActor(T, `vr-adm-${tag}@x.test`, 'vendor_admin'), fin = await mkActor(T, `vr-fin-${tag}@x.test`, 'vendor_finance'), counter = await mkActor(T, `vr-ctr-${tag}@x.test`, 'vendor_counter');
  const cust = await mkActor(T, `vr-cu-${tag}@x.test`); await fund(T, cust.userId, 1_000_000, `vr-c-${tag}`);
  const p = await createProject(cust, 'Flyer'); const f = await saveOriginal(cust, await png()); await saveProject(cust, p.id, 1, { sourceFileId: f.fileId, settings: S });
  const q = await createQuote(cust, p.id); await reserveQuote(cust, q.quoteId); await workOnce('w-vr');
  // counter sale
  const cc = await V.createCounterCustomer(counter, '=HYPERLINK("http://evil")', undefined); const cp = await V.createCounterProject(counter, cc.id, 'Banner');
  const cf = await saveOriginal(counter, await png()); await saveProject(counter, cp.id, 1, { sourceFileId: cf.fileId, settings: S });
  const cq = await createQuote(counter, cp.id); await V.recordCounterPayment(counter, cq.quoteId, { method: 'cash', amountPaise: cq.customerAmountPaise });
  await V.reserveCounter(counter, cq.quoteId); await workOnce('w-vr');
  return { T, admin, fin, counter, cust, q, cq };
}

describe('vendor reports', () => {
  it('sales totals equal the sum of the source rows, split by channel and status', async () => {
    const s = await store('VR1', 'a'); const r = await R.runReport(s.admin, 'sales');
    expect(r.rows).toHaveLength(2);
    const src = (await getPool().query("select coalesce(sum(q.customer_amount_paise),0)::bigint a, coalesce(sum(q.vendor_charge_paise),0)::bigint v, count(*)::int n from jobs j join reservations rs on rs.id=j.reservation_id join quotes q on q.id=rs.quote_id where j.tenant_id=$1 and j.status='succeeded'", [s.T])).rows[0];
    expect(r.totals).toMatchObject({ succeededJobs: src.n, succeededSalesPaise: Number(src.a), succeededProcessingChargePaise: Number(src.v) });
    expect(r.note).toMatch(/not profit/);
    expect((await R.runReport(s.fin, 'sales', { channel: 'counter' })).rows).toHaveLength(1);
    expect((await R.runReport(s.fin, 'sales', { channel: 'online', status: 'failed' })).rows).toHaveLength(0);
    expect((await R.runReport(s.fin, 'sales', { from: '2999-01-01' })).rows).toHaveLength(0);
    expect((await R.runReport(s.fin, 'sales', { from: '2000-01-01', to: '2999-01-01' })).rows).toHaveLength(2);
  });
  it('receipts, usage, credits and staff reports reconcile to their sources', async () => {
    const s = await store('VR2', 'b');
    const rc = await R.runReport(s.fin, 'receipts'); expect(rc.rows).toHaveLength(1); expect(rc.totals.recordedPaise).toBe(Number(s.cq.customerAmountPaise));
    expect(rc.note).toMatch(/did not collect/);
    expect((await R.runReport(s.fin, 'receipts', { staffId: s.admin.userId })).rows).toHaveLength(0);
    const us = await R.runReport(s.admin, 'usage'); expect(us.totals.jobs).toBe(2); expect(us.totals.succeeded).toBe(2);
    const cr = await R.runReport(s.fin, 'credits'); const bal = (await getPool().query("select coalesce(sum(e.amount_paise),0)::bigint b from ledger_entries e join ledger_accounts a on a.id=e.account_id where a.tenant_id=$1 and a.kind='vendor_processing_credit'", [s.T])).rows[0].b;
    expect(cr.totals.currentBalancePaise).toBe(Number(bal));
    const st = await R.runReport(s.admin, 'staff'); expect(st.rows.some(x => x[0] === 'vr-ctr-b@x.test')).toBe(true); expect(st.rows.some(x => x[0] === 'vr-cu-b@x.test')).toBe(false); // customers are not staff
  });
  it('is role-limited and store-scoped', async () => {
    const a = await store('VR3', 'c'), b = await store('VR4', 'd');
    await expect(R.runReport(a.counter, 'sales')).rejects.toMatchObject({ status: 403 });
    await expect(R.runReport(a.cust, 'receipts')).rejects.toMatchObject({ status: 403 });
    await expect(R.runReport(a.fin, 'staff')).rejects.toMatchObject({ status: 403 }); // admin only
    await expect(R.reportCsv(a.counter, 'sales')).rejects.toMatchObject({ status: 403 });
    const csv = await R.reportCsv(b.admin, 'receipts'); expect(csv).not.toContain('vr-ctr-c@x.test'); expect((await R.runReport(b.admin, 'sales')).rows).toHaveLength(2);
    await expect(R.runReport(b.admin, 'receipts', { staffId: a.counter.userId })).resolves.toMatchObject({ rows: [] }); // another store's staff id reveals nothing
  });
  it('rejects bad filters; CSV neutralises formulas and writes an audit row', async () => {
    const s = await store('VR5', 'e');
    await expect(R.runReport(s.admin, 'sales', { from: 'yesterday' })).rejects.toMatchObject({ code: 'invalid_filter' });
    await expect(R.runReport(s.admin, 'sales', { status: 'paid' })).rejects.toMatchObject({ code: 'invalid_filter' });
    await expect(R.runReport(s.admin, 'receipts', { staffId: "x' or 1=1" })).rejects.toMatchObject({ code: 'invalid_filter' });
    await expect(R.runReport(s.admin, 'nope' as any)).rejects.toMatchObject({ code: 'invalid_filter' });
    const csv = await R.reportCsv(s.admin, 'receipts'); expect(csv).toContain(`'=HYPERLINK`); expect(csv).not.toMatch(/(^|,)"?=HYPERLINK/m);
    expect(csv.split('\r\n')[0]).toBe('Date (IST),Receipt,Customer,Method,Amount (INR),Reference,Recorded by,Override reason');
    expect((await getPool().query("select count(*)::int n from audit_log where action='vendor.report_export' and tenant_id=$1", [s.T])).rows[0].n).toBe(1);
  });
});
