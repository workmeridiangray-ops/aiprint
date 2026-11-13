import { handler } from '@/server/http';
import * as P from '@/server/payments';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return P.createPayment(actor, { purpose: b.purpose, amountPaise: Number(b.amountPaise), orgId: b.orgId, planId: b.planId }); });
