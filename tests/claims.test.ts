import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import * as V from '../src/server/vendor';
import * as C from '../src/server/claims';
import { saveOriginal, readOriginal } from '../src/server/files';
import { saveProject, getProject } from '../src/server/projects';
import { createQuote } from '../src/server/quotes';
import { workOnce, jobStatus, readOutput } from '../src/server/worker';
import { listLibrary } from '../src/server/retention';
import { getPool } from '../src/server/db';

beforeAll(setupDb); afterAll(closePool);
const S = { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 150, fit: 'fill' as const, format: 'png' as const };
const png = () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6' } }).png().toBuffer();
let n = 0;
/** A finished, paid walk-in job for a counter customer whose recorded contact is `contact`. */
async function walkin(T: string, contact: string | undefined) {
  const k = ++n, staff = await mkActor(T, `staff${k}@x.test`, 'vendor_counter');
  await fund(T, null, 1_000_000, `v-${k}`);
  const cc = await V.createCounterCustomer(staff, 'Walk-in Ravi', contact);
  const p = await V.createCounterProject(staff, cc.id, 'Flyer');
  const f = await saveOriginal(staff, await png()); await saveProject(staff, p.id, 1, { sourceFileId: f.fileId, settings: S });
  const q = await createQuote(staff, p.id);
  const rc = await V.recordCounterPayment(staff, q.quoteId, { method: 'cash', amountPaise: q.customerAmountPaise });
  const r = await V.reserveCounter(staff, q.quoteId); await workOnce('w-claims');
  const st = await jobStatus(staff, r.jobId);
  return { staff, cc, pid: p.id, fileId: f.fileId, receipt: rc.receiptNo, outputId: st.outputId!, quoteId: q.quoteId };
}
const count = async (sql: string, args: unknown[] = []) => (await getPool().query(sql, args)).rows[0].n as number;

describe('walk-in claim: the happy path', () => {
  it('verified matching email + vendor-admin approval moves the projects, files and outputs; payments and ledger stay as they were', async () => {
    const T = await mkTenant('Claim1'); const w = await walkin(T, 'ravi@x.test');
    const customer = await mkActor(T, 'ravi@x.test'); const admin = await mkActor(T, 'adm1@x.test', 'vendor_admin');
    await expect(readOutput(customer, w.outputId)).rejects.toMatchObject({ code: 'not_found' }); // before approval: no access
    const pay0 = await count('select count(*)::int n from counter_payments'), led0 = await count('select count(*)::int n from ledger_entries');
    const req = await C.requestClaim(customer, w.receipt.toLowerCase()); // receipt typed in lower case still matches
    expect(req.status).toBe('pending');
    await expect(readOutput(customer, w.outputId)).rejects.toMatchObject({ code: 'not_found' }); // a request alone grants nothing
    const queue = await C.listClaims(admin); expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ customerName: 'Walk-in Ravi', requesterEmail: 'ravi@x.test', contactMatches: true, jobs: 1 });
    const done = await C.decideClaim(admin, req.id, 'approve');
    expect(done.status).toBe('approved'); expect(done.moved).toMatchObject({ projects: 1, outputs: 1 }); expect(done.moved!.files).toBeGreaterThanOrEqual(2);
    expect((await readOutput(customer, w.outputId)).buf.length).toBeGreaterThan(100);
    expect((await readOriginal(customer, w.fileId)).length).toBeGreaterThan(100);
    expect((await getProject(customer, w.pid)).owner_user_id).toBe(customer.userId);
    expect((await listLibrary(customer)).map((o: any) => o.id)).toContain(w.outputId);
    await expect(readOutput(w.staff, w.outputId)).rejects.toMatchObject({ code: 'not_found' }); // counter staff no longer see the customer's file
    expect(await count('select count(*)::int n from counter_payments')).toBe(pay0); expect(await count('select count(*)::int n from ledger_entries')).toBe(led0);
    expect((await getPool().query('select receipt_no, counter_customer_id from counter_payments where quote_id=$1', [w.quoteId])).rows[0]).toEqual({ receipt_no: w.receipt, counter_customer_id: w.cc.id });
    expect((await getPool().query('select claimed_by_user_id from counter_customers where id=$1', [w.cc.id])).rows[0].claimed_by_user_id).toBe(customer.userId);
    expect(await count("select count(*)::int n from email_outbox where to_email='ravi@x.test' and template='claim_approved'")).toBe(1);
    expect(await count("select count(*)::int n from audit_log where action in ('claim.request','claim.approve')")).toBeGreaterThanOrEqual(2);
  });
});

describe('walk-in claim: what must NOT work', () => {
  it('a receipt number alone is not enough: wrong email, phone-only contact, other store and unknown receipt all get the same refusal', async () => {
    const T = await mkTenant('Claim2'); const w = await walkin(T, 'owner2@x.test'); const phone = await walkin(T, '98765 43210');
    const stranger = await mkActor(T, 'stranger2@x.test'); const T2 = await mkTenant('Claim2b'); const foreign = await mkActor(T2, 'owner2@x.test');
    const msgs: string[] = [];
    for (const [a, r] of [[stranger, w.receipt], [stranger, phone.receipt], [foreign, w.receipt], [stranger, 'R-999999']] as const) {
      const e = await C.requestClaim(a, r).catch(x => x); expect(e).toMatchObject({ code: 'claim_not_matched' }); msgs.push(e.message);
    }
    expect(new Set(msgs).size).toBe(1);
    expect(await count('select count(*)::int n from walkin_claims where tenant_id in ($1,$2)', [T, T2])).toBe(0);
    await expect(readOutput(stranger, w.outputId)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('an unverified email cannot claim; repeated misses are rate limited', async () => {
    const T = await mkTenant('Claim3'); const w = await walkin(T, 'v3@x.test');
    const u = await mkActor(T, 'v3@x.test'); await getPool().query('update users set email_verified_at=null where id=$1', [u.userId]);
    await expect(C.requestClaim(u, w.receipt)).rejects.toMatchObject({ code: 'email_not_verified' });
    const g = await mkActor(T, 'guesser3@x.test');
    for (let i = 0; i < 5; i++) await expect(C.requestClaim(g, `R-90000${i}`)).rejects.toMatchObject({ code: 'claim_not_matched' });
    await expect(C.requestClaim(g, w.receipt)).rejects.toMatchObject({ code: 'too_many_attempts', status: 429 });
  });
  it('only a vendor admin of the same store can decide; customers and counter staff cannot', async () => {
    const T = await mkTenant('Claim4'); const w = await walkin(T, 'p4@x.test'); const cust = await mkActor(T, 'p4@x.test');
    const req = await C.requestClaim(cust, w.receipt);
    for (const a of [cust, w.staff]) await expect(C.decideClaim(a, req.id, 'approve')).rejects.toMatchObject({ code: 'denied' });
    const T2 = await mkTenant('Claim4b'); const otherAdmin = await mkActor(T2, 'adm4b@x.test', 'vendor_admin');
    await expect(C.decideClaim(otherAdmin, req.id, 'approve')).rejects.toMatchObject({ code: 'not_found' });
    await expect(C.listClaims(w.staff)).rejects.toMatchObject({ code: 'denied' });
    expect((await C.listClaims(otherAdmin))).toHaveLength(0);
    expect(await count("select count(*)::int n from walkin_claims where status='pending'", [])).toBeGreaterThanOrEqual(1);
  });
  it('rejecting needs a reason; a decided claim cannot be decided again; the customer sees the outcome', async () => {
    const T = await mkTenant('Claim5'); const w = await walkin(T, 'p5@x.test'); const cust = await mkActor(T, 'p5@x.test'); const admin = await mkActor(T, 'adm5@x.test', 'vendor_admin');
    const req = await C.requestClaim(cust, w.receipt);
    await expect(C.decideClaim(admin, req.id, 'reject')).rejects.toMatchObject({ code: 'reason_required' });
    await C.decideClaim(admin, req.id, 'reject', 'Receipt belongs to a different person');
    await expect(C.decideClaim(admin, req.id, 'approve')).rejects.toMatchObject({ code: 'already_decided' });
    const mine = await C.listClaims(cust, 'all'); expect(mine[0]).toMatchObject({ status: 'rejected', reason: 'Receipt belongs to a different person' });
    await expect(readOutput(cust, w.outputId)).rejects.toMatchObject({ code: 'not_found' });
    expect(await count("select count(*)::int n from email_outbox where to_email='p5@x.test' and template='claim_rejected'")).toBe(1);
  });
  it('a claimed record cannot be claimed again, and the owner is told it is already theirs', async () => {
    const T = await mkTenant('Claim6'); const w = await walkin(T, 'p6@x.test'); const cust = await mkActor(T, 'p6@x.test'); const admin = await mkActor(T, 'adm6@x.test', 'vendor_admin');
    const req = await C.requestClaim(cust, w.receipt); await C.decideClaim(admin, req.id, 'approve');
    await expect(C.requestClaim(cust, w.receipt)).rejects.toMatchObject({ code: 'already_yours' });
    expect(await count('select count(*)::int n from walkin_claims where counter_customer_id=$1', [w.cc.id])).toBe(1);
  });
});

describe('walk-in claim: conflicts and corrections', () => {
  it('two claimants escalate to conflict; approving one needs a reason and rejects the other; nothing is overwritten silently', async () => {
    const T = await mkTenant('Claim7'); const w = await walkin(T, 'shared7@x.test');
    const a = await mkActor(T, 'shared7@x.test'); const admin = await mkActor(T, 'adm7@x.test', 'vendor_admin');
    await getPool().query("insert into users(email,password_hash,email_verified_at) select 'copy7@x.test', password_hash, now() from users where id=$1", [a.userId]);
    const r1 = await C.requestClaim(a, w.receipt); expect(r1.status).toBe('pending');
    // a second person who also has the same verified address cannot exist, so simulate by moving the record's contact to a second user's address, then back
    const b = await mkActor(T, 'second7@x.test');
    await C.correctCounterContact(admin, w.cc.id, 'second7@x.test', 'Customer gave a second address');
    const r2 = await C.requestClaim(b, w.receipt); expect(r2.status).toBe('conflict');
    expect((await C.listClaims(admin)).map(x => x.status).sort()).toEqual(['conflict', 'conflict']);
    await expect(C.decideClaim(admin, r2.id, 'approve')).rejects.toMatchObject({ code: 'reason_required' });
    await C.decideClaim(admin, r2.id, 'approve', 'Showed the receipt and photo ID at the counter');
    expect((await C.listClaims(a, 'all'))[0]).toMatchObject({ status: 'rejected' });
    expect((await getProject(b, w.pid)).owner_user_id).toBe(b.userId);
    await expect(readOutput(a, w.outputId)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('approval is refused if the recorded contact changed after the request', async () => {
    const T = await mkTenant('Claim8'); const w = await walkin(T, 'p8@x.test'); const cust = await mkActor(T, 'p8@x.test'); const admin = await mkActor(T, 'adm8@x.test', 'vendor_admin');
    const req = await C.requestClaim(cust, w.receipt);
    await C.correctCounterContact(admin, w.cc.id, 'someone-else@x.test', 'Store found the wrong address was typed');
    expect(((await C.listClaims(admin))[0] as any).contactMatches).toBe(false);
    await expect(C.decideClaim(admin, req.id, 'approve')).rejects.toMatchObject({ code: 'contact_changed' });
    expect((await getProject(w.staff, w.pid)).owner_user_id).toBe(w.staff.userId); // nothing moved
  });
  it('a contact correction keeps the old value, needs a reason and an admin, and is blocked after the claim', async () => {
    const T = await mkTenant('Claim9'); const w = await walkin(T, '90000 11111'); const admin = await mkActor(T, 'adm9@x.test', 'vendor_admin');
    await expect(C.correctCounterContact(w.staff, w.cc.id, 'x@x.test', 'because')).rejects.toMatchObject({ code: 'denied' });
    await expect(C.correctCounterContact(admin, w.cc.id, 'p9@x.test', 'no')).rejects.toMatchObject({ code: 'reason_required' });
    const T2 = await mkTenant('Claim9b'); const other = await mkActor(T2, 'adm9b@x.test', 'vendor_admin');
    await expect(C.correctCounterContact(other, w.cc.id, 'p9@x.test', 'trying another store')).rejects.toMatchObject({ code: 'not_found' });
    await C.correctCounterContact(admin, w.cc.id, 'p9@x.test', 'Added the customer’s email at the counter');
    expect((await getPool().query('select old_contact,new_contact,changed_by from counter_contact_history where counter_customer_id=$1', [w.cc.id])).rows[0]).toEqual({ old_contact: '90000 11111', new_contact: 'p9@x.test', changed_by: admin.userId });
    const cust = await mkActor(T, 'p9@x.test'); const req = await C.requestClaim(cust, w.receipt); await C.decideClaim(admin, req.id, 'approve');
    await expect(C.correctCounterContact(admin, w.cc.id, 'new@x.test', 'trying after claim')).rejects.toMatchObject({ code: 'already_claimed' });
  });
  it('a claimant can cancel; the remaining claim stops being a conflict', async () => {
    const T = await mkTenant('Claim10'); const w = await walkin(T, 'c10a@x.test'); const admin = await mkActor(T, 'adm10@x.test', 'vendor_admin');
    const a = await mkActor(T, 'c10a@x.test'); const b = await mkActor(T, 'c10b@x.test');
    const r1 = await C.requestClaim(a, w.receipt);
    await C.correctCounterContact(admin, w.cc.id, 'c10b@x.test', 'second address given'); const r2 = await C.requestClaim(b, w.receipt);
    expect(r2.status).toBe('conflict');
    await C.cancelClaim(b, r2.id);
    expect((await C.listClaims(a))[0]).toMatchObject({ id: r1.id, status: 'pending' });
    await expect(C.cancelClaim(a, r2.id)).rejects.toMatchObject({ code: 'not_found' }); // not theirs
    await expect(C.cancelClaim(b, r2.id)).rejects.toMatchObject({ code: 'already_decided' });
  });
});
