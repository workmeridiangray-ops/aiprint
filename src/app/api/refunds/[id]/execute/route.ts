import { handler } from '@/server/http';
import * as F from '@/server/refunds';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => { const b = await req.json().catch(() => ({})); return F.executeRefund(actor, params.id, b.code); });
