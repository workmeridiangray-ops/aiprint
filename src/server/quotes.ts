import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { require as authorize } from './policy';
import { validateSettings, outputPixels } from './projects';
import { ensureAccount, available } from './ledger';
import { priceFor, canProcess } from './vendor';

export const QUOTE_TTL_MINUTES = 15;

export async function createQuote(actor: Actor, projectId: string) {
  return tx(async c => {
    const r = await c.query('select * from projects where id=$1', [projectId]);
    const p = r.rows[0];
    if (!p) throw new AppError('not_found', 'Project not found', 404);
    try { authorize(actor, 'project.read', { tenantId: p.tenant_id, ownerUserId: p.owner_user_id }); authorize(actor, 'quote.create', { tenantId: p.tenant_id }); }
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
export async function reserveQuote(actor: Actor, quoteId: string) {
  return tx(async c => {
    const qr = await c.query('select q.*, p.owner_user_id, p.revision as current_revision from quotes q join projects p on p.id=q.project_id where q.id=$1 for update of q', [quoteId]);
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
    const custAcc = await ensureAccount(c, q.tenant_id, 'customer_service_credit', actor.userId);
    const needVendor = Number(q.vendor_charge_paise) > 0;
    const vendAcc = needVendor ? await ensureAccount(c, q.tenant_id, 'vendor_processing_credit', null) : null;
    for (const id of [custAcc, vendAcc].filter(Boolean).sort() as string[]) await c.query('select 1 from ledger_accounts where id=$1 for update', [id]);

    const cb = await available(c, custAcc);
    if (cb.available < Number(q.customer_amount_paise)) throw new AppError('insufficient_customer_credit', 'Not enough service credit', 402);
    if (needVendor && (await available(c, vendAcc!)).available < Number(q.vendor_charge_paise)) throw new AppError('vendor_unavailable', 'This service cannot process new work right now', 402);

    const res = await c.query('insert into reservations(quote_id,customer_account_id,vendor_account_id,customer_paise,vendor_paise) values($1,$2,$3,$4,$5) returning id',
      [quoteId, custAcc, vendAcc, q.customer_amount_paise, q.vendor_charge_paise]);
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
export { getPool };
