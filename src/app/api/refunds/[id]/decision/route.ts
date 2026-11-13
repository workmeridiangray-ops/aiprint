import { handler } from '@/server/http';
import * as F from '@/server/refunds';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => { const b = await req.json(); return F.decideRefund(actor, params.id, b.approve === true, b.note, b.revokeAccess); });
