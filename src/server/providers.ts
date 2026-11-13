import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { AppError } from './db';

/** What the application needs from a payment provider. Nothing here trusts a browser: a payment is real only when
 *  `verifyWebhook` accepts a signed event or `fetchOrder` returns it from the provider's own records. */
export type ProviderEvent = { eventId: string; kind: 'payment_success' | 'payment_failed' | 'other'; orderId: string | null; paymentId: string | null; amountPaise: number | null; currency: string | null };
export type OrderState = { status: 'paid' | 'pending' | 'failed'; paymentId: string | null; amountPaise: number | null; currency: string | null };
export type MoveResult = { id: string | null; status: 'confirmed' | 'pending' | 'failed' | 'unknown'; note?: string };
export interface PaymentProvider {
  name: string;
  testMode: boolean;
  supportsTransfers: boolean;
  createOrder(p: { amountPaise: number; currency: string; receipt: string }): Promise<{ orderId: string; publicKey?: string }>;
  verifyWebhook(rawBody: string, signature: string | null, eventIdHeader: string | null): ProviderEvent;
  fetchOrder(orderId: string): Promise<OrderState>;
  refund(p: { paymentId: string; amountPaise: number; key: string }): Promise<MoveResult>;
  fetchRefund(p: { paymentId: string; refundId: string | null; key: string }): Promise<MoveResult>;
  createBeneficiary(p: { holderName: string; accountNumber: string; ifsc: string; key: string }): Promise<{ ref: string; verified: boolean }>;
  transfer(p: { beneficiaryRef: string; amountPaise: number; key: string }): Promise<MoveResult>;
  fetchTransfer(p: { transferId: string | null; key: string }): Promise<MoveResult>;
}

const env = () => process.env.APP_ENV ?? 'development';
const hmac = (secret: string, body: string) => createHmac('sha256', secret).update(body).digest('hex');
function sameSig(a: string, b: string) { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); }

/* ---------- sandbox: development and tests only; refused in staging and production ---------- */
/** Test controls. Tests set these to simulate provider behaviour (failure, unknown outcome, wrong amount). */
export const sandbox = {
  orders: new Map<string, OrderState>(),
  refunds: new Map<string, MoveResult>(),
  transfers: new Map<string, MoveResult>(),
  nextRefund: null as MoveResult['status'] | null,
  nextTransfer: null as MoveResult['status'] | null,
  transferCalls: 0,
  reset() { this.orders.clear(); this.refunds.clear(); this.transfers.clear(); this.nextRefund = null; this.nextTransfer = null; this.transferCalls = 0; },
};
export const sandboxSecret = () => process.env.SANDBOX_WEBHOOK_SECRET ?? 'sandbox-only-secret';
export function signSandboxEvent(e: ProviderEvent) { const body = JSON.stringify(e); return { body, signature: hmac(sandboxSecret(), body) }; }
const sandboxProvider: PaymentProvider = {
  name: 'sandbox', testMode: true, supportsTransfers: true,
  async createOrder() { const orderId = 'sbx_order_' + randomUUID(); sandbox.orders.set(orderId, { status: 'pending', paymentId: null, amountPaise: null, currency: null }); return { orderId }; },
  verifyWebhook(raw, sig) {
    if (!sig || !sameSig(sig, hmac(sandboxSecret(), raw))) throw new AppError('bad_signature', 'Event signature is not valid', 401);
    const e = JSON.parse(raw) as ProviderEvent;
    if (e.orderId && e.kind === 'payment_success') sandbox.orders.set(e.orderId, { status: 'paid', paymentId: e.paymentId, amountPaise: e.amountPaise, currency: e.currency });
    return e;
  },
  async fetchOrder(orderId) { return sandbox.orders.get(orderId) ?? { status: 'pending', paymentId: null, amountPaise: null, currency: null }; },
  async refund({ key }) { const prior = sandbox.refunds.get(key); if (prior) return prior; const r: MoveResult = { id: 'sbx_rf_' + randomUUID(), status: sandbox.nextRefund ?? 'confirmed' }; sandbox.nextRefund = null; sandbox.refunds.set(key, r); return r; },
  async fetchRefund({ key }) { return sandbox.refunds.get(key) ?? { id: null, status: 'failed', note: 'No such refund at the provider' }; },
  async createBeneficiary({ accountNumber }) { return { ref: 'sbx_ben_' + randomUUID(), verified: !accountNumber.endsWith('0000') }; },
  async transfer({ key }) { sandbox.transferCalls++; const prior = sandbox.transfers.get(key); if (prior) return prior; const r: MoveResult = { id: 'sbx_tr_' + randomUUID(), status: sandbox.nextTransfer ?? 'confirmed' }; sandbox.nextTransfer = null; sandbox.transfers.set(key, r); return r; },
  async fetchTransfer({ key }) { return sandbox.transfers.get(key) ?? { id: null, status: 'failed', note: 'No such transfer at the provider' }; },
};

/* ---------- Razorpay: orders, signed webhooks, order lookup, refunds. NOT exercised against a live account yet. ---------- */
function razorpay(): PaymentProvider {
  const keyId = process.env.RAZORPAY_KEY_ID, keySecret = process.env.RAZORPAY_KEY_SECRET, hookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!keyId || !keySecret || !hookSecret) throw new AppError('provider_unconfigured', 'Online payments are not available yet', 503);
  const auth = 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  async function api(method: string, path: string, body?: unknown, idem?: string) {
    let r: Response;
    try { r = await fetch('https://api.razorpay.com/v1' + path, { method, headers: { authorization: auth, 'content-type': 'application/json', ...(idem ? { 'X-Payout-Idempotency': idem } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) }); }
    catch { throw Object.assign(new AppError('provider_unreachable', 'The payment provider did not answer', 502), { unknown: true }); }
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new AppError('provider_error', 'The payment provider refused the request', 502), { unknown: r.status >= 500, providerStatus: r.status, providerCode: j?.error?.code });
    return j;
  }
  const moveStatus = (s: string): MoveResult['status'] => s === 'processed' ? 'confirmed' : s === 'failed' || s === 'reversed' || s === 'rejected' || s === 'cancelled' ? 'failed' : 'pending';
  return {
    name: 'razorpay', testMode: keyId.startsWith('rzp_test_'), supportsTransfers: false,
    async createOrder({ amountPaise, currency, receipt }) { const o = await api('POST', '/orders', { amount: amountPaise, currency, receipt }); return { orderId: o.id, publicKey: keyId }; },
    verifyWebhook(raw, sig, eventIdHeader) {
      if (!sig || !sameSig(sig, hmac(hookSecret, raw))) throw new AppError('bad_signature', 'Event signature is not valid', 401);
      const e = JSON.parse(raw); const pay = e?.payload?.payment?.entity;
      const kind = e.event === 'payment.captured' || e.event === 'order.paid' ? 'payment_success' : e.event === 'payment.failed' ? 'payment_failed' : 'other';
      // order.paid and payment.captured both describe the same money: the payment id makes them one logical event for crediting.
      return { eventId: eventIdHeader ?? `${e.event}:${pay?.id ?? e.created_at}`, kind, orderId: pay?.order_id ?? e?.payload?.order?.entity?.id ?? null, paymentId: pay?.id ?? null, amountPaise: Number.isInteger(pay?.amount) ? pay.amount : null, currency: pay?.currency ?? null };
    },
    async fetchOrder(orderId) {
      const l = await api('GET', `/orders/${encodeURIComponent(orderId)}/payments`); const items: any[] = l.items ?? [];
      const paid = items.find(p => p.status === 'captured');
      if (paid) return { status: 'paid', paymentId: paid.id, amountPaise: paid.amount, currency: paid.currency };
      return { status: items.length && items.every(p => p.status === 'failed') ? 'failed' : 'pending', paymentId: null, amountPaise: null, currency: null };
    },
    async refund({ paymentId, amountPaise, key }) {
      try { const r = await api('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { amount: amountPaise, receipt: key.slice(0, 40), notes: { key } }); return { id: r.id, status: moveStatus(r.status) }; }
      catch (e: any) { return e.unknown ? { id: null, status: 'unknown', note: e.message } : { id: null, status: 'failed', note: `Provider refused (${e.providerCode ?? e.providerStatus ?? 'error'})` }; }
    },
    async fetchRefund({ paymentId, refundId, key }) {
      const l = await api('GET', `/payments/${encodeURIComponent(paymentId)}/refunds`); const hit = (l.items ?? []).find((x: any) => x.id === refundId || x.notes?.key === key);
      return hit ? { id: hit.id, status: moveStatus(hit.status) } : { id: null, status: 'failed', note: 'The provider has no record of this refund' };
    },
    async createBeneficiary() { throw new AppError('transfers_unavailable', 'Automated bank transfers are not enabled for this payment provider', 503); },
    async transfer() { throw new AppError('transfers_unavailable', 'Automated bank transfers are not enabled for this payment provider', 503); },
    async fetchTransfer() { throw new AppError('transfers_unavailable', 'Automated bank transfers are not enabled for this payment provider', 503); },
  };
}

/** Fails closed: with no provider configured nothing can be paid, credited, refunded or transferred. The sandbox is refused outside development and tests. */
export function getProvider(): PaymentProvider {
  const name = (process.env.PAYMENT_PROVIDER ?? '').trim();
  if (!name) throw new AppError('provider_unconfigured', 'Online payments are not available yet', 503);
  if (name === 'sandbox') { if (!['development', 'test'].includes(env())) throw new AppError('provider_unconfigured', 'The sandbox payment provider cannot be used in this environment', 503); return sandboxProvider; }
  if (name === 'razorpay') return razorpay();
  throw new AppError('provider_unconfigured', `Unknown payment provider "${name}"`, 503);
}
export function providerStatus() {
  try { const p = getProvider(); return { configured: true, name: p.name, testMode: p.testMode, transfers: p.supportsTransfers }; }
  catch (e: any) { return { configured: false, name: (process.env.PAYMENT_PROVIDER ?? '') || null, testMode: false, transfers: false, problem: e.message as string }; }
}
/** Manual settlement is the written-election fallback in section 13 of the quotation. It is never switched on automatically. */
export const manualSettlement = () => process.env.SETTLEMENT_MODE === 'manual';
