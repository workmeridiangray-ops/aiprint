import { handler } from '@/server/http';
import * as C from '@/server/claims';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => { const b = await req.json().catch(() => ({})); return C.decideClaim(actor, params.id, b.decision, b.reason); });
