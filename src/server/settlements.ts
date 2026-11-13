import type pg from 'pg';
import { createHash } from 'node:crypto';
import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { audit } from './identity';
import { ensureAccount, postEntry } from './ledger';
import { getProvider, manualSettlement, type MoveResult } from './providers';
import { needFinance, raiseException } from './payments';
import { stepUp } from './refunds';

type Q = { query: pg.Pool['query'] };
const VENDOR_FIN = ['vendor_admin', 'vendor_finance'];
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/* ---------- beneficiaries (SC-067, WF-18) ---------- */
/** A store asks to set or change where it is paid. The full account number is passed to the provider once and never stored here; only the last four digits are kept. */
export async function requestBeneficiary(actor: Actor, p: { holderName: string; accountNumber: string; ifsc: string; reason: string }) {
  if (!VENDOR_FIN.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  const holder = String(p.holderName ?? '').trim(), acct = String(p.accountNumber ?? '').replace(/\s/g, ''), ifsc = String(p.ifsc ?? '').trim().toUpperCase(), reason = String(p.reason ?? '').trim();
  if (holder.length < 2 || holder.length > 120) throw new AppError('invalid_holder', 'Enter the account holder name');
  if (!/^[0-9]{6,18}$/.test(acct)) throw new AppError('invalid_account', 'Enter the bank account number (digits only)');
  if (!IFSC.test(ifsc)) throw new AppError('invalid_ifsc', 'Enter a valid IFSC code');
  if (reason.length < 10) throw new AppError('invalid_reason', 'Give a reason of at least 10 characters');
  let ref: string | null = null, verified = false;
  if (!manualSettlement()) { // automated transfers: the provider holds the destination
    const provider = getProvider(); if (!provider.supportsTransfers) throw new AppError('transfers_unavailable', 'Automated bank transfers are not enabled for the configured payment provider', 503);
    const b = await provider.createBeneficiary({ holderName: holder, accountNumber: acct, ifsc, key: `ben:${actor.tenantId}:${createHash('sha256').update(acct + ifsc).digest('hex').slice(0, 16)}` });
    ref = b.ref; verified = b.verified;
  }
  return tx(async c => {
    await c.query('select 1 from tenants where id=$1 for update', [actor.tenantId]);
    await c.query("update beneficiaries set status='superseded', decided_at=now() where tenant_id=$1 and status in ('requested','verified')", [actor.tenantId]); // one open request at a time; the approved one stays active until a new one is approved
    const v = Number((await c.query('select coalesce(max(version),0)+1 v from beneficiaries where tenant_id=$1', [actor.tenantId])).rows[0].v);
    const r = (await c.query('insert into beneficiaries(tenant_id,version,holder_name,account_last4,ifsc,provider_ref,status,change_reason,requested_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',
      [actor.tenantId, v, holder, acct.slice(-4), ifsc, ref, verified ? 'verified' : 'requested', reason.slice(0, 500), actor.userId])).rows[0];
    await c.query("insert into email_outbox(to_email,template,body) select u.email,'beneficiary_change','{}' from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.role='vendor_admin' and m.revoked_at is null and u.status='active'", [actor.tenantId]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'beneficiary.requested', type: 'beneficiary', id: r.id, outcome: verified ? 'verified' : 'awaiting_verification' });
    return { id: r.id as string, version: v, status: verified ? 'verified' : 'requested' };
  });
}
const maskB = (b: any) => ({ id: b.id, version: b.version, holderName: b.holder_name, account: '•••• ' + b.account_last4, ifsc: b.ifsc, status: b.status, reason: b.change_reason, note: b.decision_note, verificationRef: b.verification_ref, createdAt: b.created_at });
export async function myBeneficiaries(actor: Actor) {
  if (!VENDOR_FIN.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  return { mode: manualSettlement() ? 'manual' : 'automated', rows: (await getPool().query('select * from beneficiaries where tenant_id=$1 order by version desc limit 20', [actor.tenantId])).rows.map(maskB) };
}
export async function listBeneficiaries(actor: Actor) {
  needFinance(actor);
  const r = await getPool().query("select b.*, t.name as tenant from beneficiaries b join tenants t on t.id=b.tenant_id where b.status in ('requested','verified','approved') order by (b.status='approved'), b.created_at desc limit 200");
  return r.rows.map(b => ({ ...maskB(b), tenant: b.tenant, mine: b.requested_by === actor.userId || b.verified_by === actor.userId }));
}
/** Finance records that the destination was verified (manual mode: with a reference to the evidence, such as a cancelled cheque check or a penny-drop result). */
export async function verifyBeneficiary(actor: Actor, id: string, verificationRef: string) {
  needFinance(actor);
  const ref = String(verificationRef ?? '').trim(); if (ref.length < 3) throw new AppError('evidence_required', 'Give a reference for how the account was verified');
  const r = await getPool().query("update beneficiaries set status='verified', verification_ref=$2, verified_by=$3 where id=$1 and status='requested' returning tenant_id", [id, ref.slice(0, 200), actor.userId]);
  if (!r.rowCount) throw new AppError('invalid_transition', 'This request is not waiting for verification', 409);
  await audit(getPool(), { actor: actor.userId, tenant: r.rows[0].tenant_id, action: 'beneficiary.verified', type: 'beneficiary', id, outcome: 'ok' });
  return { status: 'verified' };
}
/** A second finance identity approves (or refuses) a verified destination. Needs a fresh second factor. Approval retires the previous destination. */
export async function decideBeneficiary(actor: Actor, id: string, approve: boolean, note?: string, code?: string) {
  needFinance(actor);
  return tx(async c => {
    const b = (await c.query('select * from beneficiaries where id=$1 for update', [id])).rows[0];
    if (!b) throw new AppError('not_found', 'Request not found', 404);
    if (!['requested', 'verified'].includes(b.status)) throw new AppError('invalid_transition', `This request is already ${b.status}`, 409);
    if (!approve) { const n = String(note ?? '').trim(); if (n.length < 3) throw new AppError('reason_required', 'Say why it is refused'); await c.query("update beneficiaries set status='rejected', decision_note=$2, decided_at=now() where id=$1", [id, n.slice(0, 500)]); }
    else {
      if (b.status !== 'verified') throw new AppError('not_verified', 'The account has not been verified yet', 409);
      if (b.verified_by === actor.userId || b.requested_by === actor.userId) throw new AppError('self_approval', 'Verification and approval must be done by different people', 403);
      await stepUp(c, actor.userId, code);
      await c.query("update beneficiaries set status='superseded', decided_at=now() where tenant_id=$1 and status='approved'", [b.tenant_id]);
      await c.query("update beneficiaries set status='approved', approved_by=$2, decided_at=now(), decision_note=$3 where id=$1", [id, actor.userId, String(note ?? '').trim().slice(0, 500) || null]);
    }
    await audit(c, { actor: actor.userId, tenant: b.tenant_id, action: approve ? 'beneficiary.approved' : 'beneficiary.rejected', type: 'beneficiary', id, outcome: 'ok' });
    return { status: approve ? 'approved' : 'rejected' };
  });
}

/* ---------- settlement runs (SC-068, WF-17) ---------- */
/** Month boundaries are Asia/Kolkata calendar months. */
export function periodBounds(period: string) {
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(period)) throw new AppError('invalid_period', 'Period must look like 2026-11');
  const [y, m] = period.split('-').map(Number);
  const start = new Date(`${period}-01T00:00:00+05:30`), end = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+05:30`);
  return { start, end };
}
type Line = { tenant_id: string; opening: number; sales: number; refunds: number; adjustments: number; payouts: number; payable: number; held: number; hold_reason: string | null; transfer: number; beneficiary_id: string | null; status: string };
/** Statement arithmetic per store: opening + online sales − refunds ± adjustments − payouts in the period = payable. Processing credit is a separate prepaid account and is never deducted here. */
async function computeLines(c: Q, start: Date, end: Date): Promise<Line[]> {
  const rows = (await c.query(`select a.tenant_id,
      coalesce(sum(e.amount_paise) filter (where e.created_at < $1),0)::bigint as opening,
      coalesce(sum(e.amount_paise) filter (where e.created_at >= $1 and e.reason='sale_earned'),0)::bigint as sales,
      coalesce(sum(e.amount_paise) filter (where e.created_at >= $1 and e.reason='refund'),0)::bigint as refunds,
      coalesce(sum(e.amount_paise) filter (where e.created_at >= $1 and e.reason='adjustment'),0)::bigint as adjustments,
      coalesce(sum(e.amount_paise) filter (where e.created_at >= $1 and e.reason='payout'),0)::bigint as payouts,
      coalesce(sum(e.amount_paise),0)::bigint as payable
    from ledger_accounts a join ledger_entries e on e.account_id=a.id where a.kind='vendor_payable' and e.created_at < $2 group by a.tenant_id order by a.tenant_id`, [start, end])).rows;
  const out: Line[] = [];
  for (const r of rows) {
    const ben = (await c.query("select id from beneficiaries where tenant_id=$1 and status='approved'", [r.tenant_id])).rows[0];
    const ex = Number((await c.query("select count(*)::int n from finance_exceptions where tenant_id=$1 and status<>'resolved'", [r.tenant_id])).rows[0].n);
    const openRefunds = Number((await c.query("select coalesce(sum(amount_paise),0)::bigint v from refunds where tenant_id=$1 and kind='job_charge' and status in ('requested','approved','submitted','unknown')", [r.tenant_id])).rows[0].v);
    const payable = Number(r.payable);
    let hold: string | null = null, held = 0, status = 'pending';
    if (payable <= 0) { status = 'skipped'; hold = payable < 0 ? 'Negative balance carried forward' : null; }
    else if (ex) { status = 'held'; held = payable; hold = `${ex} open finance exception${ex === 1 ? '' : 's'}`; }
    else if (!ben) { status = 'held'; held = payable; hold = 'No approved payout destination'; }
    else if (openRefunds) { held = Math.min(payable, openRefunds); hold = 'Refunds in progress'; if (held === payable) status = 'held'; }
    out.push({ tenant_id: r.tenant_id, opening: Number(r.opening), sales: Number(r.sales), refunds: Number(r.refunds), adjustments: Number(r.adjustments), payouts: Number(r.payouts), payable, held, hold_reason: hold, transfer: Math.max(0, payable - held), beneficiary_id: ben?.id ?? null, status });
  }
  return out;
}
const hashLines = (l: Line[]) => createHash('sha256').update(JSON.stringify(l.map(x => [x.tenant_id, x.opening, x.sales, x.refunds, x.adjustments, x.payouts, x.payable, x.held, x.transfer, x.beneficiary_id, x.status]))).digest('hex');

/** Creates or refreshes the draft for a finished month. Refreshing after approval, when anything changed, cancels the approval. */
export async function prepareRun(actor: Actor, period: string, now = new Date()) {
  needFinance(actor);
  const { start, end } = periodBounds(period);
  if (end > now) throw new AppError('period_open', 'That month has not ended yet (Indian time)', 409);
  return tx(async c => {
    await c.query("select pg_advisory_xact_lock(hashtext('settlement:' || $1))", [period]);
    const lines = await computeLines(c, start, end), hash = hashLines(lines);
    let run = (await c.query('select * from settlement_runs where period=$1 for update', [period])).rows[0];
    if (run && ['initiated', 'completed'].includes(run.status)) throw new AppError('invalid_transition', 'Transfers for this period have already started', 409);
    if (run && run.snapshot_hash === hash) return { id: run.id as string, status: run.status as string, changed: false };
    if (!run) run = (await c.query('insert into settlement_runs(period,period_start,period_end,snapshot_hash,prepared_by) values($1,$2,$3,$4,$5) returning *', [period, start, end, hash, actor.userId])).rows[0];
    else await c.query("update settlement_runs set status='draft', snapshot_hash=$2, prepared_by=$3, approved_by=null, approved_at=null where id=$1", [run.id, hash, actor.userId]);
    await c.query('delete from settlement_lines where run_id=$1', [run.id]);
    for (const l of lines) await c.query('insert into settlement_lines(run_id,tenant_id,opening_paise,sales_paise,refunds_paise,adjustments_paise,payouts_paise,payable_paise,held_paise,hold_reason,transfer_paise,beneficiary_id,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [run.id, l.tenant_id, l.opening, l.sales, l.refunds, l.adjustments, l.payouts, l.payable, l.held, l.hold_reason, l.transfer, l.beneficiary_id, l.status]);
    await audit(c, { actor: actor.userId, action: 'settlement.prepared', type: 'settlement_run', id: run.id, outcome: `${lines.length} stores` });
    return { id: run.id as string, status: 'draft', changed: true };
  });
}
async function stillCurrent(c: Q, run: any) { return hashLines(await computeLines(c, new Date(run.period_start), new Date(run.period_end))) === run.snapshot_hash; }
export async function approveRun(actor: Actor, runId: string, code?: string) {
  needFinance(actor);
  return tx(async c => {
    const run = (await c.query('select * from settlement_runs where id=$1 for update', [runId])).rows[0];
    if (!run) throw new AppError('not_found', 'Run not found', 404);
    if (run.status !== 'draft') throw new AppError('invalid_transition', `This run is already ${run.status}`, 409);
    if (run.prepared_by === actor.userId) throw new AppError('self_approval', 'The person who prepared a run cannot approve it', 403);
    if (!(await stillCurrent(c, run))) throw new AppError('run_stale', 'Figures changed since this run was prepared. Prepare it again, then approve.', 409);
    await stepUp(c, actor.userId, code);
    await c.query("update settlement_runs set status='approved', approved_by=$2, approved_at=now() where id=$1", [runId, actor.userId]);
    await audit(c, { actor: actor.userId, action: 'settlement.approved', type: 'settlement_run', id: runId, outcome: 'ok' });
    return { status: 'approved' };
  });
}
async function recordTransfer(c: Q, line: any, res: MoveResult) {
  if (res.status === 'confirmed') {
    await postEntry(c, await ensureAccount(c, line.tenant_id, 'vendor_payable', null), -Number(line.transfer_paise), 'payout', `payout:${line.id}`);
    await c.query("update settlement_lines set status='confirmed', provider_transfer_id=coalesce($2,provider_transfer_id), updated_at=now() where id=$1", [line.id, res.id]);
    await c.query("insert into email_outbox(to_email,template,body) select u.email,'settlement_update',$2 from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.role in ('vendor_admin','vendor_finance') and m.revoked_at is null and u.status='active'", [line.tenant_id, JSON.stringify({ status: 'confirmed' })]);
  } else if (res.status === 'failed') {
    await c.query("update settlement_lines set status='failed', note=$2, provider_transfer_id=coalesce($3,provider_transfer_id), updated_at=now() where id=$1", [line.id, (res.note ?? 'The provider refused the transfer').slice(0, 300), res.id]);
  } else if (res.status === 'unknown') {
    await c.query("update settlement_lines set status='unknown', note=$2, updated_at=now() where id=$1", [line.id, (res.note ?? 'No answer from the provider').slice(0, 300)]);
    await raiseException(c, { kind: 'transfer_unknown', dedupeKey: `transfer-unknown:${line.id}:${line.attempt}`, tenantId: line.tenant_id, detail: 'A settlement transfer was sent but the provider did not confirm or refuse it. It must be checked with the provider before any retry.' });
  } else if (res.id) await c.query('update settlement_lines set provider_transfer_id=$2, updated_at=now() where id=$1', [line.id, res.id]);
  await audit(c, { tenant: line.tenant_id, action: 'settlement.transfer_' + res.status, type: 'settlement_line', id: line.id, outcome: String(line.transfer_paise) });
}
async function finishRunIfDone(c: Q, runId: string) {
  const open = Number((await c.query("select count(*)::int n from settlement_lines where run_id=$1 and status in ('pending','initiated','unknown','failed')", [runId])).rows[0].n);
  if (!open) await c.query("update settlement_runs set status='completed' where id=$1 and status='initiated'", [runId]);
}
/** Starts the approved transfers. Each line's intent is saved before the provider is called, and each call carries a key that is stable for that attempt, so a repeat cannot pay twice.
 *  Lines that failed (confirmed failure) are retried with a new attempt; lines with an unknown outcome are never retried until reconciled. */
export async function initiateRun(actor: Actor, runId: string, code?: string) {
  needFinance(actor);
  if (manualSettlement()) throw new AppError('manual_mode', 'Transfers are recorded by hand in this installation. Record each bank transfer on its line.', 409);
  const provider = getProvider(); if (!provider.supportsTransfers) throw new AppError('transfers_unavailable', 'Automated bank transfers are not enabled for the configured payment provider', 503);
  const todo = await tx(async c => {
    const run = (await c.query('select * from settlement_runs where id=$1 for update', [runId])).rows[0];
    if (!run) throw new AppError('not_found', 'Run not found', 404);
    if (!['approved', 'initiated'].includes(run.status)) throw new AppError('invalid_transition', run.status === 'draft' ? 'This run has not been approved' : `This run is ${run.status}`, 409);
    await stepUp(c, actor.userId, code);
    if (run.status === 'approved') {
      if (!(await stillCurrent(c, run))) { await c.query("update settlement_runs set status='draft', approved_by=null, approved_at=null where id=$1", [runId]); return 'stale' as const; }
      await c.query("update settlement_runs set status='initiated' where id=$1", [runId]);
    }
    const lines = (await c.query("select l.*, b.provider_ref, b.status as ben_status from settlement_lines l left join beneficiaries b on b.id=l.beneficiary_id where l.run_id=$1 and l.status in ('pending','failed') and l.transfer_paise > 0 for update of l", [runId])).rows;
    const out = [];
    for (const l of lines) {
      if (l.ben_status !== 'approved' || !l.provider_ref) { await c.query("update settlement_lines set status='held', hold_reason='Payout destination changed or is no longer approved', updated_at=now() where id=$1", [l.id]); continue; }
      await c.query("update settlement_lines set status='initiated', attempt=attempt+1, note=null, updated_at=now() where id=$1", [l.id]);
      out.push({ ...l, attempt: l.attempt + 1 });
    }
    await audit(c, { actor: actor.userId, action: 'settlement.initiated', type: 'settlement_run', id: runId, outcome: `${out.length} transfers` });
    return out;
  });
  if (todo === 'stale') throw new AppError('run_stale', 'Figures changed after approval. The run is a draft again and needs a new approval.', 409);
  for (const l of todo) {
    let res: MoveResult;
    try { res = await provider.transfer({ beneficiaryRef: l.provider_ref, amountPaise: Number(l.transfer_paise), key: `settle:${l.id}:${l.attempt}` }); } catch (e: any) { res = { id: null, status: 'unknown', note: e.message }; }
    await tx(async c => { const cur = (await c.query('select * from settlement_lines where id=$1 for update', [l.id])).rows[0]; if (cur.status === 'initiated') await recordTransfer(c, cur, res); });
  }
  await tx(c => finishRunIfDone(c, runId));
  return runDetail(actor, runId);
}
/** Asks the provider about transfers that are in flight or unknown. Never sends money. */
export async function reconcileTransfers() {
  if (manualSettlement()) return { skipped: 'manual settlement' };
  let provider; try { provider = getProvider(); } catch { return { skipped: 'no provider configured' }; }
  if (!provider.supportsTransfers) return { skipped: 'provider has no transfers' };
  const lines = (await getPool().query("select id, run_id, attempt, provider_transfer_id from settlement_lines where status in ('initiated','unknown')")).rows; let settled = 0;
  for (const l of lines) {
    let res: MoveResult; try { res = await provider.fetchTransfer({ transferId: l.provider_transfer_id, key: `settle:${l.id}:${l.attempt}` }); } catch { continue; }
    if (res.status === 'pending' || res.status === 'unknown') continue;
    await tx(async c => { const cur = (await c.query('select * from settlement_lines where id=$1 for update', [l.id])).rows[0]; if (['initiated', 'unknown'].includes(cur.status)) { await recordTransfer(c, cur, res); settled++; } await finishRunIfDone(c, l.run_id); });
  }
  return { checked: lines.length, settled };
}
/** Manual mode only (the written-election fallback): finance records a bank transfer it made outside the system, once per line. */
export async function recordManualTransfer(actor: Actor, lineId: string, reference: string, code?: string) {
  needFinance(actor);
  if (!manualSettlement()) throw new AppError('not_manual', 'Manual transfer recording is not enabled', 409);
  const ref = String(reference ?? '').trim(); if (ref.length < 4) throw new AppError('reference_required', 'Enter the bank reference for the transfer');
  return tx(async c => {
    const l = (await c.query('select l.*, r.status as run_status from settlement_lines l join settlement_runs r on r.id=l.run_id where l.id=$1 for update of l', [lineId])).rows[0];
    if (!l) throw new AppError('not_found', 'Line not found', 404);
    if (!['approved', 'initiated'].includes(l.run_status)) throw new AppError('invalid_transition', 'The run must be approved first', 409);
    if (l.status !== 'pending' || !(Number(l.transfer_paise) > 0)) throw new AppError('invalid_transition', `This line is ${l.status}`, 409);
    await stepUp(c, actor.userId, code);
    await c.query("update settlement_runs set status='initiated' where id=$1 and status='approved'", [l.run_id]);
    await c.query('update settlement_lines set manual_reference=$2, attempt=attempt+1 where id=$1', [lineId, ref.slice(0, 100)]);
    await recordTransfer(c, l, { id: null, status: 'confirmed' });
    await finishRunIfDone(c, l.run_id);
    return { status: 'confirmed' };
  });
}
export async function listRuns(actor: Actor) {
  needFinance(actor);
  const r = await getPool().query(`select r.id, r.period, r.status, r.created_at, r.prepared_by, pu.email as preparer, au.email as approver,
    (select count(*)::int from settlement_lines l where l.run_id=r.id) as stores, (select coalesce(sum(transfer_paise),0)::bigint from settlement_lines l where l.run_id=r.id) as total
    from settlement_runs r join users pu on pu.id=r.prepared_by left join users au on au.id=r.approved_by order by r.period desc limit 36`);
  return { mode: manualSettlement() ? 'manual' : 'automated', runs: r.rows.map(x => ({ id: x.id, period: x.period, status: x.status, preparer: x.preparer, approver: x.approver, stores: x.stores, totalPaise: Number(x.total), preparedByMe: x.prepared_by === actor.userId })) };
}
const lineOut = (l: any) => ({ id: l.id, tenant: l.tenant, openingPaise: Number(l.opening_paise), salesPaise: Number(l.sales_paise), refundsPaise: Number(l.refunds_paise), adjustmentsPaise: Number(l.adjustments_paise), payoutsPaise: Number(l.payouts_paise), payablePaise: Number(l.payable_paise), heldPaise: Number(l.held_paise), holdReason: l.hold_reason, transferPaise: Number(l.transfer_paise), status: l.status, reference: l.provider_transfer_id ?? l.manual_reference, note: l.note });
export async function runDetail(actor: Actor, runId: string) {
  needFinance(actor);
  const run = (await getPool().query('select id, period, status, prepared_by from settlement_runs where id=$1', [runId])).rows[0];
  if (!run) throw new AppError('not_found', 'Run not found', 404);
  const lines = (await getPool().query('select l.*, t.name as tenant from settlement_lines l join tenants t on t.id=l.tenant_id where l.run_id=$1 order by t.name', [runId])).rows;
  return { id: run.id as string, period: run.period as string, status: run.status as string, preparedByMe: run.prepared_by === actor.userId, mode: manualSettlement() ? 'manual' : 'automated', lines: lines.map(lineOut) };
}
/** The store's own statement (SC-033): balance owed, each month's movements from the ledger, and what each settlement run did. */
export async function vendorStatement(actor: Actor) {
  if (!VENDOR_FIN.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  const pool = getPool(); const acc = await ensureAccount(pool, actor.tenantId, 'vendor_payable', null);
  const months = (await pool.query(`select to_char(created_at at time zone 'Asia/Kolkata','YYYY-MM') as period,
      coalesce(sum(amount_paise) filter (where reason='sale_earned'),0)::bigint sales, coalesce(sum(amount_paise) filter (where reason='refund'),0)::bigint refunds,
      coalesce(sum(amount_paise) filter (where reason='adjustment'),0)::bigint adjustments, coalesce(sum(amount_paise) filter (where reason='payout'),0)::bigint payouts
    from ledger_entries where account_id=$1 group by 1 order by 1 desc limit 24`, [acc])).rows;
  const bal = Number((await pool.query('select coalesce(sum(amount_paise),0)::bigint v from ledger_entries where account_id=$1', [acc])).rows[0].v);
  const lines = (await pool.query("select l.*, r.period, r.status as run_status, '' as tenant from settlement_lines l join settlement_runs r on r.id=l.run_id where l.tenant_id=$1 and r.status<>'draft' order by r.period desc limit 24", [actor.tenantId])).rows;
  return { balancePaise: bal, months: months.map(m => ({ period: m.period, salesPaise: Number(m.sales), refundsPaise: Number(m.refunds), adjustmentsPaise: Number(m.adjustments), payoutsPaise: Number(m.payouts) })), settlements: lines.map(l => ({ period: l.period, runStatus: l.run_status, ...lineOut(l) })) };
}
