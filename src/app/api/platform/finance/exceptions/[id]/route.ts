import { handler } from '@/server/http';
import * as P from '@/server/payments';
export const runtime = 'nodejs';
export const PATCH = handler(async (req, { actor, params }) => { const b = await req.json(); return P.updateException(actor, params.id, b); });
