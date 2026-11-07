import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => { const b = await req.json(); return V.recordCounterPayment(actor, params.id, b.overrideReason !== undefined ? { overrideReason: String(b.overrideReason) } : { method: String(b.method ?? ''), amountPaise: Number(b.amountPaise), reference: b.reference ? String(b.reference) : undefined }); });
