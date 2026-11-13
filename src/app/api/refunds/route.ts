import { handler } from '@/server/http';
import * as F from '@/server/refunds';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => F.listRefunds(actor));
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return F.requestRefund(actor, { kind: b.kind, jobId: b.jobId, paymentId: b.paymentId, amountPaise: Number(b.amountPaise), reason: b.reason, method: b.method, revokeAccess: !!b.revokeAccess }); });
