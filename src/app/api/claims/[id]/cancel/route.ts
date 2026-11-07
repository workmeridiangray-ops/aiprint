import { handler } from '@/server/http';
import * as C from '@/server/claims';
export const runtime = 'nodejs';
export const POST = handler(async (_req, { actor, params }) => { await C.cancelClaim(actor, params.id); return { ok: true }; });
