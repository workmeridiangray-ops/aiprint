import { handler } from '@/server/http';
import * as P from '@/server/payments';
export const runtime = 'nodejs';
// Called by the payment provider, not a browser: authenticated by the signature over the raw body.
export const POST = handler(async (req, { params }) => { const raw = await req.text(); const r = await P.handleWebhook(params.provider, raw, req.headers.get('x-razorpay-signature') ?? req.headers.get('x-sandbox-signature'), req.headers.get('x-razorpay-event-id')); return { ok: true, outcome: r.outcome }; }, { public: true, webhook: true });
