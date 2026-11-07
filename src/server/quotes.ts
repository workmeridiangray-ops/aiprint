import { assertStorageAvailable } from './quota';
import { audit } from './identity';
import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { require as authorize } from './policy';
import { validateSettings, outputPixels } from './projects';
import { ensureAccount, ensureOrgAccount, available } from './ledger';
import { canReadProject, monthUsage } from './org';
import { priceFor, canProcess } from './vendor';
import { notifyJob } from './queue';

export const QUOTE_TTL_MINUTES = 15;

export async function createQuote(actor: Actor, projectId: string) {
  return tx(async c => {
    const r = await c.query('select * from projects where id=$1', [projectId]);
    const p = r.rows[0];
    if (!p) throw new AppError('not_found', 'Project not found', 404);
    try { authorize(actor, 'project.save', { tenantId: p.tenant_id, ownerUserId: p.owner_user_id }); authorize(actor, 'quote.create', { tenantId: p.tenant_id }); if (p.org_id && !(await canReadProject(c, actor, p))) throw 0; }
    catch { throw new AppError('not_found', 'Project not found', 404); }
    if (!p.source_file_id) throw new AppError('no_source', 'Add an image before requesting a price');
    const settings = validateSettings(p.settings);
    const { customer, vendor, retailId, platformId } = await priceFor(c, p.tenant_id, outputPixels(settings).total);
    const q = await c.query(
      `insert into quotes(tenant_id,project_id,project_revision,source_file_id,settings_snapshot,customer_amount_paise,vendor_charge_paise,pricing_version,channel,retail_pricing_id,platform_pricing_id,expires_at)
       values($1,$2,$3,$9,$4,$5,$6,$7,$10,$11,$12, now() + ($8 || ' minutes')::interval) returning id, expires_at`,
      [p.tenant_id, p.id, p.revision, JSON.stringify(settings), customer, vendor, `retail:${retailId}/platform:${platformId ?? 'none'}`, String(QUOTE_TTL_MINUTES), p.source_file_id, p.counter_customer_id ? 'counter' : 'online', retailId, platformId]);
    return { quoteId: q.rows[0].id as string, expiresAt: q.rows[0].expires_at as Date, customerAmountPaise: customer, vendorChargePaise: vendor };
  });
}

/** Atomically holds customer retail credit and vendor processing credit, then creates the queued job.
 *  Accounts are locked in id order (no deadlock); available = settled - held is checked under lock, so concurrent requests cannot overspend. */
/** Reserves funds and queues the job in one transaction; only after it commits is the worker nudged (best effort). */
export async function reserveQuote(actor: Actor, quoteId: string) {
  const r = await reserveQuoteTx(actor, quoteId); if (!r.repeated) await notifyJob(r.jobId); return r;
}
async function reserveQuoteTx(actor: Actor, quoteId: string) {
  return tx(async c => {
    const qr = await c.query('select q.*, p.owner_user_id, p.org_id, p.revision as current_revision from quotes q join projects p on p.id=q.project_id where q.id=$1 for update of q', [quoteId]);
    const q = qr.rows[0];
    if (!q) throw new AppError('not_found', 'Quote not found', 404);
    try { authorize(actor, 'quote.reserve', { tenantId: q.tenant_id }); if (q.owner_user_id !== actor.userId) throw 0; }
    catch { throw new AppError('not_found', 'Quote not found', 404); }

    if (q.channel !== 'online') throw new AppError('wrong_channel', 'Counter work is processed from the counter screen', 409);
    const existing = await c.query('select id from reservations where quote_id=$1', [quoteId]);
    if (existing.rowCount) { const j = await c.query('select id from jobs where reservation_id=$1', [existing.rows[0].id]); return { reservationId: existing.rows[0].id as string, jobId: j.rows[0].id as string, repeated: true }; }

    if (new Date(q.expires_at) <= new Date()) throw new AppError('quote_expired', 'This price has expired. Request a new price.', 409);
    if (q.current_revision !== q.project_revision) throw new AppError('quote_stale', 'The artwork changed after this price was given. Request a new price.', 409);

    if (!(await canProcess(c, q.tenant_id))) throw new AppError('subscription_inactive', 'This service cannot process new work right now', 402);
    await assertStorageAvailable(c, q.tenant_id);
    let member: { monthly_limit_paise: string | null; role: string } | null = null;
    if (q.org_id) { // lock the member row first (always before any account) so per-member caps are checked atomically
      const m = await c.query("select m.monthly_limit_paise, m.role from org_members m join organisations o on o.id=m.org_id where m.org_id=$1 and m.user_id=$2 and m.revoked_at is null and o.status='active' for update of m", [q.org_id, actor.userId]);
      if (!m.rowCount) throw new AppError('not_found', 'Quote not found', 404);
      member = m.rows[0];
    }
    const custAcc = q.org_id ? await ensureOrgAccount(c, q.tenant_id, q.org_id) : await ensureAccount(c, q.tenant_id, 'customer_service_credit', actor.userId);
    const needVendor = Number(q.vendor_charge_paise) > 0;
    const vendAcc = needVendor ? await ensureAccount(c, q.tenant_id, 'vendor_processing_credit', null) : null;
    for (const id of [custAcc, vendAcc].filter(Boolean).sort() as string[]) await c.query('select 1 from ledger_accounts where id=$1 for update', [id]);

    const cb = await available(c, custAcc);
    if (cb.available < Number(q.customer_amount_paise)) throw new AppError(q.org_id ? 'insufficient_organisation_credit' : 'insufficient_customer_credit', q.org_id ? 'The organisation does not have enough shared credit' : 'Not enough service credit', 402);
    if (member && member.monthly_limit_paise !== null) {
      const u = await monthUsage(c, q.org_id, actor.userId);
      if (u.spent + u.reserved + Number(q.customer_amount_paise) > Number(member.monthly_limit_paise)) throw new AppError('member_limit_reached', 'This would exceed your monthly spending limit for the organisation', 402);
    }
    if (needVendor && (await available(c, vendAcc!)).available < Number(q.vendor_charge_paise)) throw new AppError('vendor_unavailable', 'This service cannot process new work right now', 402);

    const res = await c.query('insert into reservations(quote_id,customer_account_id,vendor_account_id,customer_paise,vendor_paise,org_id,spender_user_id) values($1,$2,$3,$4,$5,$6,$7) returning id',
      [quoteId, custAcc, vendAcc, q.customer_amount_paise, q.vendor_charge_paise, q.org_id ?? null, q.org_id ? actor.userId : null]);
    const job = await c.query("insert into jobs(tenant_id,reservation_id,status) values($1,$2,'queued') returning id", [q.tenant_id, res.rows[0].id]);
    return { reservationId: res.rows[0].id as string, jobId: job.rows[0].id as string, repeated: false };
  });
}

/** Releases a hold that never dispatched (undispatched = job still 'queued'). Running/unknown jobs keep their hold. */
export async function cancelBeforeDispatch(actor: Actor, jobId: string) {
  return tx(async c => {
    const r = await c.query(`select j.id, j.status, j.reservation_id, j.tenant_id, p.owner_user_id from jobs j
      join reservations r on r.id=j.reservation_id join quotes q on q.id=r.quote_id join projects p on p.id=q.project_id where j.id=$1 for update of j`, [jobId]);
    const j = r.rows[0];
    if (!j || j.tenant_id !== actor.tenantId || j.owner_user_id !== actor.userId) throw new AppError('not_found', 'Job not found', 404);
    if (j.status !== 'queued') {
      if (j.status === 'running') { await c.query("update jobs set status='cancellation_requested' where id=$1", [jobId]); return { status: 'cancellation_requested' }; }
      throw new AppError('invalid_transition', `A ${j.status} job cannot be cancelled`, 409);
    }
    await c.query("update jobs set status='cancelled' where id=$1", [jobId]);
    await c.query("update reservations set status='released', released_at=now() where id=$1 and status='held'", [j.reservation_id]);
    return { status: 'cancelled' };
  });
}
/** BE-04: a hold whose job was never picked up is released after HOLD_EXPIRY_MINUTES (default 30, a proposed value awaiting client confirmation).
 *  Only jobs still 'queued' with zero attempts are touched; running or unknown jobs keep their hold. Nothing was charged, so nothing is refunded. */
export async function expireUndispatchedHolds(maxAgeMinutes = Number(process.env.HOLD_EXPIRY_MINUTES ?? 30)) {
  if (!(maxAgeMinutes > 0)) throw new Error('HOLD_EXPIRY_MINUTES must be positive');
  return tx(async c => {
    const r = await c.query(`select j.id, j.reservation_id, j.tenant_id from jobs j where j.status='queued' and j.attempts=0 and j.created_at < now() - ($1 || ' minutes')::interval for update skip locked`, [String(maxAgeMinutes)]);
    for (const j of r.rows) {
      await c.query("update jobs set status='cancelled', last_error='Not started in time; hold released' where id=$1", [j.id]);
      await c.query("update reservations set status='released', released_at=now() where id=$1 and status='held'", [j.reservation_id]);
      await audit(c, { tenant: j.tenant_id, action: 'job.hold_expired', type: 'job', id: j.id, outcome: 'released' });
    }
    return { released: r.rows.length };
  });
}
export { getPool };
