import { handler } from '@/server/http';
import * as P from '@/server/payments';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => { const b = await req.json(); return P.sandboxComplete(actor, params.id, b.outcome === 'success' ? 'success' : 'failed'); });
