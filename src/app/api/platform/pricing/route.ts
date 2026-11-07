import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => { const b = await req.json(); await V.setPlatformPricing(actor, Number(b.perMpPaise), Number(b.minPaise)); return { ok: true }; });
