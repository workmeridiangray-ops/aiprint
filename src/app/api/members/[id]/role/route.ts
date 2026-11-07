import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => { await V.changeRole(actor, params.id, String((await req.json()).role ?? '')); return { ok: true }; });
