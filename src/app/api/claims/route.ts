import { handler } from '@/server/http';
import * as C from '@/server/claims';
export const runtime = 'nodejs';
export const GET = handler(async (req, { actor }) => C.listClaims(actor, new URL(req.url).searchParams.get('status') === 'all' ? 'all' : 'open'));
export const POST = handler(async (req, { actor }) => { const b = await req.json().catch(() => ({})); return C.requestClaim(actor, b.receiptNo); });
