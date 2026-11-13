import type pg from 'pg';
import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { audit } from './identity';
import { ensureAccount, postEntry, available } from './ledger';
import { getProvider, type MoveResult } from './providers';
import { FIN, needFinance, raiseException } from './payments';
import { proveTotp } from './mfa';

type Q = { query: pg.Pool['query'] };
const VENDOR_APPROVERS = ['vendor_admin', 'vendor_finance'];
const OPEN = "('requested','approved','submitted','confirmed','unknown')"; // everything that still counts against the refundable amount

/** Fresh second factor for sensitive finance actions. Accounts with two-step sign-in must give a current code; platform finance roles are required to enrol in staging and production. */
export async function stepUp(c: Q, userId: string, code: string | undefined) {
  const u = (await c.query('select mfa_enabled_at from users where id=$1', [userId])).rows[0];
  if (u?.mfa_enabled_at) await proveTotp(c as any, userId, String(code ?? ''));
  else if (['staging', 'production'].includes(process.env.APP_ENV ?? '')) throw new AppError('mfa_required', 'Turn on two-step sign-in before approving or executing money movements', 403);
}
const notify = (c: Q, userId: string, reference: string, status: string) =>
  c.query("insert into email_outbox(to_email,template,body) select email,'refund_update',$2 from users where id=$1 and status='active'", [userId, JSON.stringify({ reference, status })]);

export type RefundRequest = { kind: 'job_charge' | 'unused_credit'; jobId?: string; paymentId?: string; amountPaise: number; reason: string; method?: 'credit' | 'provider'; revokeAccess?: boolean };
export async function requestRefund(actor: Actor, p: RefundRequest) {
  const amount = Number(p.amountPaise), reason = String(p.reason ?? '').trim();
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError('invalid_amount', 'Enter the amount to refund');
  if (reason.length < 10 || reason.length > 2000) throw new AppError('invalid_reason', 'Give a reason of at least 10 characters');
  return tx(async c => {
    let row: { tenant: string; account: string; job: string | null; payment: string | null; method: string };
    if (p.kind === 'job_charge') {
      const j = (await c.query(`select j.id, j.status, j.tenant_id, r.customer_account_id, r.customer_paise, q.channel, pr.owner_user_id from jobs j join reservations r on r.id=j.reservation_id
        join quotes q on q.id=r.quote_id join projects pr on pr.id=q.project_id where j.id=$1 for update of j`, [p.jobId])).rows[0];
      const mine = j && j.tenant_id === actor.tenantId && ((actor.role === 'customer' && j.owner_user_id === actor.userId) || ['vendor_admin', 'vendor_support', 'vendor_finance'].includes(actor.role));
      if (!mine) throw new AppError('not_found', 'Job not found', 404);
      if (j.status !== 'succeeded') throw new AppError('not_refundable', 'Only a completed, charged job can be refunded. A failed or cancelled job was never charged.', 409);
      if (j.channel !== 'online' || !j.customer_account_id || Number(j.customer_paise) === 0) throw new AppError('not_refundable', 'This job was not paid through the platform. Counter payments are settled by the store directly.', 409);
      const used = Number((await c.query(`select coalesce(sum(amount_paise),0)::bigint v from refunds where job_id=$1 and status in ${OPEN}`, [j.id])).rows[0].v);
      if (used + amount > Number(j.customer_paise)) throw new AppError('over_refund', `At most ₹${((Number(j.customer_paise) - used) / 100).toFixed(2)} of this charge can still be refunded`, 409);
      row = { tenant: j.tenant_id, account: j.customer_account_id, job: j.id, payment: null, method: p.method === 'provider' ? 'provider' : 'credit' };
    } else if (p.kind === 'unused_credit') {
      if (actor.role !== 'customer') throw new AppError('denied', 'Not permitted', 403);
      const pay = (await c.query("select id, amount_paise from payments where id=$1 and user_id=$2 and tenant_id=$3 and purpose='customer_topup' and status='success' for update", [p.paymentId, actor.userId, actor.tenantId])).rows[0];
      if (!pay) throw new AppError('not_found', 'Payment not found', 404);
      const acc = await ensureAccount(c, actor.tenantId, 'customer_service_credit', actor.userId);
      await c.query('select 1 from ledger_accounts where id=$1 for update', [acc]);
      const back = Number((await c.query(`select coalesce(sum(amount_paise),0)::bigint v from refunds where payment_id=$1 and status in ${OPEN}`, [pay.id])).rows[0].v);
      const pendingUnused = Number((await c.query("select coalesce(sum(amount_paise),0)::bigint v from refunds where account_id=$1 and kind='unused_credit' and status='requested'", [acc])).rows[0].v);
      if (back + amount > Number(pay.amount_paise)) throw new AppError('over_refund', 'That is more than is left of this payment', 409);
      if ((await available(c, acc)).available - pendingUnused < amount) throw new AppError('over_refund', 'Only unused credit can be returned. Part of this credit has been used or is on hold.', 409);
      row = { tenant: actor.tenantId, account: acc, job: null, payment: pay.id, method: 'provider' };
    } else throw new AppError('invalid_kind', 'Unknown refund type');
    const ins = (await c.query('insert into refunds(tenant_id,kind,job_id,account_id,amount_paise,method,payment_id,revoke_access,reason,requested_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, reference',
      [row.tenant, p.kind, row.job, row.account, amount, row.method, row.payment, !!p.revokeAccess && actor.role !== 'customer', reason, actor.userId])).rows[0];
    await audit(c, { actor: actor.userId, tenant: row.tenant, action: 'refund.requested', type: 'refund', id: ins.id, outcome: p.kind });
    return { id: ins.id as string, reference: ins.reference as string, status: 'requested' };
  });
}

/** Approval is a decision, not a payment. Job-charge refunds are approved by the store (or the owner for the direct store); unused-credit refunds by platform finance. */
export async function decideRefund(actor: Actor, id: string, approve: boolean, note?: string, revokeAccess?: boolean) {
  return tx(async c => {
    const r = (await c.query('select r.*, t.kind as tenant_kind from refunds r join tenants t on t.id=r.tenant_id where r.id=$1 for update of r', [id])).rows[0];
    const ok = r && (r.kind === 'job_charge'
      ? (r.tenant_kind === 'vendor' ? VENDOR_APPROVERS.includes(actor.role) && actor.tenantId === r.tenant_id : actor.role === 'platform_owner')
      : FIN.includes(actor.role));
    if (!ok) throw new AppError('not_found', 'Refund not found', 404);
    if (r.status !== 'requested') throw new AppError('invalid_transition', `This refund is already ${r.status}`, 409);
    const n = String(note ?? '').trim().slice(0, 500);
    if (!approve) {
      if (n.length < 3) throw new AppError('reason_required', 'Say why the refund is refused');
      await c.query("update refunds set status='rejected', approved_by=$2, approved_at=now(), decision_note=$3, updated_at=now() where id=$1", [id, actor.userId, n]);
    } else {
      if (r.kind === 'unused_credit') { // take the credit out of circulation now so it cannot be spent while the money is on its way back
        await c.query('select 1 from ledger_accounts where id=$1 for update', [r.account_id]);
        if ((await available(c, r.account_id)).available < Number(r.amount_paise)) throw new AppError('over_refund', 'The credit has been used since the request was made', 409);
        await postEntry(c, r.account_id, -Number(r.amount_paise), 'refund_hold', `refund:${id}:hold`);
      }
      await c.query("update refunds set status='approved', approved_by=$2, approved_at=now(), decision_note=$3, revoke_access=$4, updated_at=now() where id=$1", [id, actor.userId, n || null, r.kind === 'job_charge' ? (revokeAccess ?? r.revoke_access) : false]);
    }
    await notify(c, r.requested_by, r.reference, approve ? 'approved' : 'rejected');
    await audit(c, { actor: actor.userId, tenant: r.tenant_id, action: approve ? 'refund.approved' : 'refund.rejected', type: 'refund', id, outcome: 'ok' });
    return { status: approve ? 'approved' : 'rejected' };
  });
}

/** Ledger and entitlement effects of a confirmed refund. Idempotent keys make a repeat harmless. The same value is returned once: as credit OR through the provider, never both. */
async function applyConfirmed(c: Q, r: any) {
  if (r.kind === 'job_charge') {
    if (r.method === 'credit') await postEntry(c, r.account_id, Number(r.amount_paise), 'refund_credit', `refund:${r.id}:credit`);
    const j = (await c.query('select rs.customer_paise, q.channel, t.kind from jobs j join reservations rs on rs.id=j.reservation_id join quotes q on q.id=rs.quote_id join tenants t on t.id=j.tenant_id where j.id=$1', [r.job_id])).rows[0];
    // The store earned this sale; the refund comes back out of what it is owed. If it was already paid out the balance goes negative and is carried forward: no bank debit is made.
    if (j.kind === 'vendor' && j.channel === 'online') await postEntry(c, await ensureAccount(c, r.tenant_id, 'vendor_payable', null), -Number(r.amount_paise), 'refund', `refund:${r.id}:payable`);
    const done = Number((await c.query("select coalesce(sum(amount_paise),0)::bigint v from refunds where job_id=$1 and (status='confirmed' or id=$2)", [r.job_id, r.id])).rows[0].v);
    if (done >= Number(j.customer_paise) || r.revoke_access) await c.query('update outputs set revoked_at=coalesce(revoked_at, now()) where job_id=$1', [r.job_id]); // full refund ends future downloads; a partial one keeps them unless the store asked otherwise
  }
  await c.query("update refunds set status='confirmed', updated_at=now() where id=$1", [r.id]);
  await notify(c, r.requested_by, r.reference, 'confirmed');
  await audit(c, { tenant: r.tenant_id, action: 'refund.confirmed', type: 'refund', id: r.id, outcome: r.method });
}
async function applyResult(c: Q, r: any, res: MoveResult) {
  if (res.id) await c.query('update refunds set provider_refund_id=$2 where id=$1', [r.id, res.id]);
  if (res.status === 'confirmed') return applyConfirmed(c, r);
  if (res.status === 'pending') return; // stays submitted; the scheduled check asks again
  if (res.status === 'unknown') {
    await c.query("update refunds set status='unknown', updated_at=now() where id=$1", [r.id]);
    await raiseException(c, { kind: 'refund_unknown', dedupeKey: 'refund-unknown:' + r.id, tenantId: r.tenant_id, paymentId: r.payment_id, detail: `Refund ${r.reference}: the provider did not confirm or refuse it. It must be checked with the provider before any retry.` });
    return;
  }
  if (r.kind === 'unused_credit') await postEntry(c, r.account_id, Number(r.amount_paise), 'refund_hold_reversed', `refund:${r.id}:hold-reversed`);
  await c.query("update refunds set status='failed', decision_note=$2, updated_at=now() where id=$1", [r.id, (res.note ?? 'The provider refused the refund').slice(0, 500)]);
  await raiseException(c, { kind: 'refund_failed', dedupeKey: 'refund-failed:' + r.id, tenantId: r.tenant_id, paymentId: r.payment_id, detail: `Refund ${r.reference} failed at the provider. The customer has not been repaid.` });
  await notify(c, r.requested_by, r.reference, 'failed');
}

/** Platform finance carries out an approved refund. The person who approved cannot also execute. Nothing is called "refunded" until the provider confirms. */
export async function executeRefund(actor: Actor, id: string, code?: string) {
  needFinance(actor);
  const pre = await tx(async c => {
    const r = (await c.query('select * from refunds where id=$1 for update', [id])).rows[0];
    if (!r) throw new AppError('not_found', 'Refund not found', 404);
    if (r.status !== 'approved') throw new AppError('invalid_transition', r.status === 'requested' ? 'This refund has not been approved yet' : `This refund is already ${r.status}`, 409);
    if (r.approved_by === actor.userId) throw new AppError('self_approval', 'The person who approved a refund cannot also execute it', 403);
    await stepUp(c, actor.userId, code);
    if (r.method === 'credit') { await c.query('update refunds set executed_by=$2 where id=$1', [id, actor.userId]); await applyConfirmed(c, r); return { done: true as const }; }
    let payId = r.payment_id as string | null;
    if (!payId) { // job charge going back to the bank: use the customer's most recent top-up that still has enough unrefunded money on it
      const owner = (await c.query('select owner_user_id, org_id from ledger_accounts where id=$1', [r.account_id])).rows[0];
      const cands = (await c.query(`select p.id, p.amount_paise - coalesce((select sum(x.amount_paise) from refunds x where x.payment_id=p.id and x.status in ${OPEN}),0) as left_paise from payments p
        where p.tenant_id=$1 and p.status='success' and ((p.purpose='customer_topup' and p.user_id=$2) or (p.purpose='org_topup' and p.org_id=$3)) order by p.created_at desc for update of p`, [r.tenant_id, owner.owner_user_id, owner.org_id])).rows;
      payId = cands.find(x => Number(x.left_paise) >= Number(r.amount_paise))?.id ?? null;
      if (!payId) throw new AppError('no_payment', 'No single payment by this customer has enough left to refund this amount. Refund it as credit, or split it.', 409);
    } else {
      const pay = (await c.query('select amount_paise from payments where id=$1 for update', [payId])).rows[0];
      const back = Number((await c.query(`select coalesce(sum(amount_paise),0)::bigint v from refunds where payment_id=$1 and id<>$2 and status in ('submitted','confirmed','unknown')`, [payId, id])).rows[0].v);
      if (back + Number(r.amount_paise) > Number(pay.amount_paise)) throw new AppError('over_refund', 'That is more than is left of the payment', 409);
    }
    const pp = (await c.query('select provider, provider_payment_id from payments where id=$1', [payId])).rows[0];
    const provider = getProvider(); if (provider.name !== pp.provider || !pp.provider_payment_id) throw new AppError('provider_mismatch', 'That payment was taken by a provider that is not configured now', 409);
    await c.query("update refunds set status='submitted', executed_by=$2, payment_id=$3, updated_at=now() where id=$1", [id, actor.userId, payId]); // intent is saved before the provider is called
    await audit(c, { actor: actor.userId, tenant: r.tenant_id, action: 'refund.submitted', type: 'refund', id, outcome: 'ok' });
    return { done: false as const, providerPaymentId: pp.provider_payment_id as string, amount: Number(r.amount_paise) };
  });
  if (!pre.done) {
    let res: MoveResult;
    try { res = await getProvider().refund({ paymentId: pre.providerPaymentId, amountPaise: pre.amount, key: 'refund:' + id }); } catch (e: any) { res = { id: null, status: 'unknown', note: e.message }; }
    await tx(async c => { const r = (await c.query('select * from refunds where id=$1 for update', [id])).rows[0]; if (r.status === 'submitted') await applyResult(c, r, res); });
  }
  return { status: (await getPool().query('select status from refunds where id=$1', [id])).rows[0].status as string };
}
/** Scheduled and on demand: ask the provider about refunds that are submitted or unknown. Never sends a second refund. */
export async function reconcileRefunds() {
  let provider; try { provider = getProvider(); } catch { return { skipped: 'no provider configured' }; }
  const rows = (await getPool().query("select r.id, r.provider_refund_id, p.provider_payment_id from refunds r join payments p on p.id=r.payment_id where r.status in ('submitted','unknown') and r.method='provider' and p.provider=$1", [provider.name])).rows;
  let settled = 0;
  for (const x of rows) {
    let res: MoveResult; try { res = await provider.fetchRefund({ paymentId: x.provider_payment_id, refundId: x.provider_refund_id, key: 'refund:' + x.id }); } catch { continue; }
    if (res.status === 'pending' || res.status === 'unknown') continue;
    await tx(async c => { const r = (await c.query('select * from refunds where id=$1 for update', [x.id])).rows[0]; if (['submitted', 'unknown'].includes(r.status)) { await applyResult(c, r, res); settled++; } });
  }
  return { checked: rows.length, settled };
}
export async function listRefunds(actor: Actor) {
  const scope = actor.role === 'customer' ? 'r.requested_by=$1 and r.tenant_id=$2' : VENDOR_APPROVERS.includes(actor.role) || actor.role === 'vendor_support' ? 'r.tenant_id=$2 and $1::uuid is not null' : FIN.includes(actor.role) ? '$1::uuid is not null and $2::uuid is not null' : null;
  if (!scope) throw new AppError('denied', 'Not permitted', 403);
  const r = await getPool().query(`select r.id, r.reference, r.kind, r.job_id, r.amount_paise, r.method, r.revoke_access, r.reason, r.status, r.decision_note, r.created_at, t.name as tenant, t.kind as tenant_kind, u.email as requester, r.approved_by
    from refunds r join tenants t on t.id=r.tenant_id join users u on u.id=r.requested_by where ${scope} order by r.created_at desc limit 200`, [actor.userId, actor.tenantId]);
  return r.rows.map(x => ({ id: x.id, reference: x.reference, kind: x.kind, jobId: x.job_id, amountPaise: Number(x.amount_paise), method: x.method, revokeAccess: x.revoke_access, reason: x.reason, status: x.status, note: x.decision_note, createdAt: x.created_at, tenant: x.tenant, tenantKind: x.tenant_kind, requester: actor.role === 'customer' ? undefined : x.requester, approvedByMe: x.approved_by === actor.userId }));
}

/* ---------- credit adjustments (SC-065): proposed by one finance identity, approved by another, posted once ---------- */
export async function proposeAdjustment(actor: Actor, p: { accountId: string; amountPaise: number; reason: string; evidence: string }) {
  needFinance(actor);
  const amount = Number(p.amountPaise), reason = String(p.reason ?? '').trim(), evidence = String(p.evidence ?? '').trim();
  if (!Number.isInteger(amount) || amount === 0) throw new AppError('invalid_amount', 'Enter a non-zero amount');
  if (reason.length < 10) throw new AppError('invalid_reason', 'Give a reason of at least 10 characters');
  if (evidence.length < 3) throw new AppError('evidence_required', 'Give a reference to the evidence for this correction');
  const pool = getPool();
  if (!(await pool.query('select 1 from ledger_accounts where id=$1', [p.accountId])).rowCount) throw new AppError('not_found', 'Account not found', 404);
  const r = (await pool.query('insert into credit_adjustments(account_id,amount_paise,reason,evidence,proposed_by) values($1,$2,$3,$4,$5) returning id, reference', [p.accountId, amount, reason.slice(0, 2000), evidence.slice(0, 500), actor.userId])).rows[0];
  await audit(pool, { actor: actor.userId, action: 'adjustment.proposed', type: 'credit_adjustment', id: r.id, outcome: 'ok' });
  return { id: r.id as string, reference: r.reference as string };
}
export async function decideAdjustment(actor: Actor, id: string, approve: boolean, note?: string, code?: string) {
  needFinance(actor);
  return tx(async c => {
    const a = (await c.query('select * from credit_adjustments where id=$1 for update', [id])).rows[0];
    if (!a) throw new AppError('not_found', 'Adjustment not found', 404);
    if (a.status !== 'proposed') throw new AppError('invalid_transition', `This adjustment is already ${a.status}`, 409);
    if (a.proposed_by === actor.userId) throw new AppError('self_approval', 'You cannot decide your own proposal', 403);
    if (approve) {
      await stepUp(c, actor.userId, code);
      await c.query('select 1 from ledger_accounts where id=$1 for update', [a.account_id]);
      const kind = (await c.query('select kind from ledger_accounts where id=$1', [a.account_id])).rows[0].kind;
      if (Number(a.amount_paise) < 0 && kind !== 'vendor_payable' && (await available(c, a.account_id)).available < -Number(a.amount_paise)) throw new AppError('insufficient_balance', 'The account no longer has that much available', 409);
      await postEntry(c, a.account_id, Number(a.amount_paise), 'adjustment', 'adj:' + id);
    }
    await c.query('update credit_adjustments set status=$2, decided_by=$3, decided_at=now(), decision_note=$4 where id=$1', [id, approve ? 'approved' : 'rejected', actor.userId, String(note ?? '').trim().slice(0, 500) || null]);
    await audit(c, { actor: actor.userId, action: approve ? 'adjustment.approved' : 'adjustment.rejected', type: 'credit_adjustment', id, outcome: 'ok' });
    return { status: approve ? 'approved' : 'rejected' };
  });
}
export async function listAdjustments(actor: Actor) {
  needFinance(actor);
  const r = await getPool().query(`select a.id, a.reference, a.amount_paise, a.reason, a.evidence, a.status, a.created_at, a.decision_note, a.proposed_by, la.kind, t.name as tenant, u.email as owner, pu.email as proposer
    from credit_adjustments a join ledger_accounts la on la.id=a.account_id join tenants t on t.id=la.tenant_id left join users u on u.id=la.owner_user_id join users pu on pu.id=a.proposed_by order by (a.status<>'proposed'), a.created_at desc limit 200`);
  return r.rows.map(a => ({ id: a.id, reference: a.reference, amountPaise: Number(a.amount_paise), reason: a.reason, evidence: a.evidence, status: a.status, note: a.decision_note, createdAt: a.created_at, accountKind: a.kind, tenant: a.tenant, owner: a.owner, proposer: a.proposer, mine: a.proposed_by === actor.userId }));
}
