import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => ({ pricing: await V.getRetailPricing(actor) }));
export const PUT = handler(async (req, { actor }) => { const b = await req.json(); await V.setRetailPricing(actor, Number(b.perMpPaise), Number(b.minPaise)); return { ok: true }; });
