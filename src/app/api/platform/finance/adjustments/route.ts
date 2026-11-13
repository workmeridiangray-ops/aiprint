import { handler } from '@/server/http';
import * as F from '@/server/refunds';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => F.listAdjustments(actor));
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return F.proposeAdjustment(actor, { accountId: b.accountId, amountPaise: Number(b.amountPaise), reason: b.reason, evidence: b.evidence }); });
