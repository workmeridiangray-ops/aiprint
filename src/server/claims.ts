import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { audit } from './identity';

/** SC-030 / WF-13. Rules from the quotation: authenticated customer + verified matching contact + vendor-admin confirmation.
 *  Knowing a receipt number or phone number alone never grants anything. Payment and ledger history is never touched. */
const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();
const NOT_MATCHED = () => new AppError('claim_not_matched', 'We could not match that receipt number to your verified email address. Check the receipt number, or ask the store to check the contact on your record.', 422);
const MAX_MISSES_PER_HOUR = 5;
const OPEN = ['pending', 'conflict'];
function need(actor: Actor, roles: string[]) { if (!roles.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403); }

export async function requestClaim(actor: Actor, receiptNo: string) {
  need(actor, ['customer']);
  const rn = String(receiptNo ?? '').trim().toUpperCase().slice(0, 30);
  if (!rn) throw new AppError('invalid_request', 'Enter the receipt number');
  const misses = (await getPool().query("select count(*)::int n from audit_log where actor_user_id=$1 and action='claim.not_matched' and at > now() - interval '1 hour'", [actor.userId])).rows[0].n;
  if (misses >= MAX_MISSES_PER_HOUR) throw new AppError('too_many_attempts', 'Too many attempts. Please wait an hour and try again, or ask the store for help.', 429);
  const u = (await getPool().query('select email, email_verified_at, closed_at from users where id=$1', [actor.userId])).rows[0];
  if (!u || !u.email_verified_at || u.closed_at) throw new AppError('email_not_verified', 'Confirm your email address first. A claim needs a verified email.', 403);
  const hit = (await getPool().query(`select cc.id, cc.contact, cc.claimed_by_user_id from counter_payments cp join counter_customers cc on cc.id=cp.counter_customer_id where cp.receipt_no=$1 and cp.tenant_id=$2`, [rn, actor.tenantId])).rows[0];
  if (!hit || norm(hit.contact) !== norm(u.email)) { // same answer whether the receipt is unknown, belongs to another store, or has another contact
    await audit(getPool(), { actor: actor.userId, tenant: actor.tenantId, action: 'claim.not_matched', type: 'receipt', id: rn, outcome: 'refused' });
    throw NOT_MATCHED();
  }
  if (hit.claimed_by_user_id) throw new AppError(hit.claimed_by_user_id === actor.userId ? 'already_yours' : 'already_claimed', hit.claimed_by_user_id === actor.userId ? 'This record is already linked to your account.' : 'This record has already been claimed. Please contact the store.', 409);
  return tx(async c => {
    await c.query('select 1 from counter_customers where id=$1 for update', [hit.id]);
    const again = (await c.query('select claimed_by_user_id from counter_customers where id=$1', [hit.id])).rows[0];
    if (again.claimed_by_user_id) throw new AppError('already_claimed', 'This record has already been claimed. Please contact the store.', 409);
    const ex = (await c.query("select id, status from walkin_claims where counter_customer_id=$1 and requester_user_id=$2 and status = any($3)", [hit.id, actor.userId, OPEN])).rows[0];
    if (ex) return { id: ex.id as string, status: ex.status as string, repeated: true };
    const ins = await c.query('insert into walkin_claims(tenant_id,counter_customer_id,requester_user_id,receipt_no,requester_email) values($1,$2,$3,$4,$5) returning id', [actor.tenantId, hit.id, actor.userId, rn, u.email]);
    const others = (await c.query("select count(*)::int n from walkin_claims where counter_customer_id=$1 and requester_user_id<>$2 and status = any($3)", [hit.id, actor.userId, OPEN])).rows[0].n;
    let status = 'pending';
    if (others > 0) { await c.query("update walkin_claims set status='conflict' where counter_customer_id=$1 and status = any($2)", [hit.id, OPEN]); status = 'conflict'; } // never auto-overwrite: escalate to the vendor admin
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'claim.request', type: 'walkin_claim', id: ins.rows[0].id, outcome: status });
    return { id: ins.rows[0].id as string, status, repeated: false };
  });
}

export async function listClaims(actor: Actor, status: 'open' | 'all' = 'open') {
  need(actor, ['customer', 'vendor_admin']);
  const where = status === 'open' ? "and w.status = any(array['pending','conflict'])" : '';
  if (actor.role === 'customer') {
    const r = await getPool().query(`select w.id, w.status, w.receipt_no, w.created_at, w.decision_reason, w.decided_at from walkin_claims w where w.requester_user_id=$1 and w.tenant_id=$2 ${where} order by w.created_at desc limit 100`, [actor.userId, actor.tenantId]);
    return r.rows.map(x => ({ id: x.id as string, status: x.status as string, receiptNo: x.receipt_no as string, createdAt: new Date(x.created_at).toISOString(), decidedAt: x.decided_at ? new Date(x.decided_at).toISOString() : null, reason: x.decision_reason as string | null }));
  }
  const r = await getPool().query(`select w.id, w.status, w.receipt_no, w.created_at, w.decision_reason, w.requester_email, w.counter_customer_id, cc.name, cc.contact,
      (select count(*)::int from projects p where p.counter_customer_id=cc.id) as projects,
      (select count(*)::int from projects p join quotes q on q.project_id=p.id join reservations rs on rs.quote_id=q.id join jobs j on j.reservation_id=rs.id where p.counter_customer_id=cc.id) as jobs,
      u.email_verified_at is not null and u.closed_at is null as requester_ok
    from walkin_claims w join counter_customers cc on cc.id=w.counter_customer_id join users u on u.id=w.requester_user_id
    where w.tenant_id=$1 ${where} order by w.created_at desc limit 200`, [actor.tenantId]);
  return r.rows.map(x => ({ id: x.id as string, status: x.status as string, receiptNo: x.receipt_no as string, createdAt: new Date(x.created_at).toISOString(), requesterEmail: x.requester_email as string, counterCustomerId: x.counter_customer_id as string, customerName: x.name as string, recordedContact: x.contact as string | null,
    contactMatches: norm(x.contact) === norm(x.requester_email) && !!x.requester_ok, projects: x.projects as number, jobs: x.jobs as number, reason: x.decision_reason as string | null }));
}

export async function cancelClaim(actor: Actor, claimId: string) {
  need(actor, ['customer']);
  return tx(async c => {
    const w = (await c.query('select id, counter_customer_id, status from walkin_claims where id=$1 and requester_user_id=$2 and tenant_id=$3 for update', [claimId, actor.userId, actor.tenantId])).rows[0];
    if (!w) throw new AppError('not_found', 'Claim not found', 404);
    if (!OPEN.includes(w.status)) throw new AppError('already_decided', 'This claim has already been decided', 409);
    await c.query("update walkin_claims set status='cancelled', decided_at=now() where id=$1", [w.id]);
    const left = (await c.query("select id from walkin_claims where counter_customer_id=$1 and status = any($2)", [w.counter_customer_id, OPEN])).rows;
    if (left.length === 1) await c.query("update walkin_claims set status='pending' where id=$1", [left[0].id]); // no longer a conflict
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'claim.cancel', type: 'walkin_claim', id: w.id, outcome: 'ok' });
  });
}

/** Vendor admin approves or rejects. Approval moves ownership of the walk-in projects, their files and finished outputs to the claimant, in one transaction.
 *  Counter payments, receipts and ledger rows are not changed. A conflicting claim needs a written reason; approving one rejects the rest. */
export async function decideClaim(actor: Actor, claimId: string, decision: 'approve' | 'reject', reason?: string) {
  need(actor, ['vendor_admin']);
  const why = (reason ?? '').trim().slice(0, 300);
  if (decision !== 'approve' && decision !== 'reject') throw new AppError('invalid_request', 'decision must be approve or reject');
  if (decision === 'reject' && why.length < 5) throw new AppError('reason_required', 'Give a short reason for rejecting (at least 5 characters)');
  const out = await tx(async c => {
    const w = (await c.query('select * from walkin_claims where id=$1 and tenant_id=$2 for update', [claimId, actor.tenantId])).rows[0];
    if (!w) throw new AppError('not_found', 'Claim not found', 404);
    if (!OPEN.includes(w.status)) throw new AppError('already_decided', 'This claim has already been decided', 409);
    if (decision === 'reject') {
      await c.query("update walkin_claims set status='rejected', decided_by=$2, decided_at=now(), decision_reason=$3 where id=$1", [w.id, actor.userId, why]);
      const left = (await c.query("select id from walkin_claims where counter_customer_id=$1 and status = any($2)", [w.counter_customer_id, OPEN])).rows;
      if (left.length === 1) await c.query("update walkin_claims set status='pending' where id=$1", [left[0].id]);
      await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'claim.reject', type: 'walkin_claim', id: w.id, outcome: 'ok' });
      return { email: w.requester_email as string, result: 'rejected' as const, reason: why, moved: null as null | { projects: number; files: number; outputs: number } };
    }
    if (w.status === 'conflict' && why.length < 5) throw new AppError('reason_required', 'Two or more people claimed this record. Write why you are approving this one (at least 5 characters).');
    const cc = (await c.query('select id, contact, claimed_by_user_id from counter_customers where id=$1 for update', [w.counter_customer_id])).rows[0];
    if (cc.claimed_by_user_id) throw new AppError('already_claimed', 'This record has already been claimed', 409);
    const u = (await c.query('select email, email_verified_at, closed_at from users where id=$1', [w.requester_user_id])).rows[0];
    if (!u || !u.email_verified_at || u.closed_at || norm(u.email) !== norm(cc.contact)) throw new AppError('contact_changed', 'The recorded contact no longer matches the claimant’s verified email. Correct the record or reject the claim.', 409);
    const uid = w.requester_user_id as string, ccid = cc.id as string;
    const proj = await c.query('update projects set owner_user_id=$2 where counter_customer_id=$1', [ccid, uid]);
    const files = await c.query(`update stored_files set owner_user_id=$2 where id in (
        select source_file_id from projects where counter_customer_id=$1 and source_file_id is not null
        union select q.source_file_id from quotes q join projects p on p.id=q.project_id where p.counter_customer_id=$1
        union select o.file_id from outputs o join jobs j on j.id=o.job_id join reservations rs on rs.id=j.reservation_id join quotes q on q.id=rs.quote_id join projects p on p.id=q.project_id where p.counter_customer_id=$1)`, [ccid, uid]);
    const outs = await c.query(`update outputs set owner_user_id=$2 where id in (
        select o.id from outputs o join jobs j on j.id=o.job_id join reservations rs on rs.id=j.reservation_id join quotes q on q.id=rs.quote_id join projects p on p.id=q.project_id where p.counter_customer_id=$1)`, [ccid, uid]);
    await c.query('update counter_customers set claimed_by_user_id=$2, claimed_at=now() where id=$1', [ccid, uid]);
    await c.query("update walkin_claims set status='approved', decided_by=$2, decided_at=now(), decision_reason=$3 where id=$1", [w.id, actor.userId, why || null]);
    const lost = (await c.query("update walkin_claims set status='rejected', decided_by=$2, decided_at=now(), decision_reason='Another claim for this record was approved' where counter_customer_id=$1 and status = any($3) returning requester_email", [ccid, actor.userId, OPEN])).rows;
    for (const l of lost) await c.query("insert into email_outbox(to_email,template,body) values($1,'claim_rejected',$2)", [l.requester_email, JSON.stringify({ reason: 'Another claim for this record was approved.' })]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'claim.approve', type: 'walkin_claim', id: w.id, outcome: `projects ${proj.rowCount}, files ${files.rowCount}, outputs ${outs.rowCount}` });
    return { email: w.requester_email as string, result: 'approved' as const, reason: why, moved: { projects: proj.rowCount ?? 0, files: files.rowCount ?? 0, outputs: outs.rowCount ?? 0 } };
  });
  await getPool().query('insert into email_outbox(to_email,template,body) values($1,$2,$3)', [out.email, out.result === 'approved' ? 'claim_approved' : 'claim_rejected', JSON.stringify({ reason: out.reason })]);
  return { status: out.result, moved: out.moved };
}

/** Vendor admin corrects a counter record's contact (for example to add the customer's email). Old value and reason are kept. Not allowed once the record is claimed. */
export async function correctCounterContact(actor: Actor, counterCustomerId: string, newContact: string, reason: string) {
  need(actor, ['vendor_admin']);
  const nc = String(newContact ?? '').trim().slice(0, 120), why = String(reason ?? '').trim().slice(0, 300);
  if (!nc) throw new AppError('invalid_request', 'Enter the new contact');
  if (why.length < 5) throw new AppError('reason_required', 'Give a short reason (at least 5 characters)');
  return tx(async c => {
    const cc = (await c.query('select id, contact, claimed_by_user_id from counter_customers where id=$1 and tenant_id=$2 for update', [counterCustomerId, actor.tenantId])).rows[0];
    if (!cc) throw new AppError('not_found', 'Customer not found', 404);
    if (cc.claimed_by_user_id) throw new AppError('already_claimed', 'This record is already linked to a customer account and cannot be edited here', 409);
    await c.query('insert into counter_contact_history(counter_customer_id,old_contact,new_contact,reason,changed_by) values($1,$2,$3,$4,$5)', [cc.id, cc.contact, nc, why, actor.userId]);
    await c.query('update counter_customers set contact=$2 where id=$1', [cc.id, nc]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'counter.contact_corrected', type: 'counter_customer', id: cc.id, outcome: 'ok' });
    return { ok: true };
  });
}
