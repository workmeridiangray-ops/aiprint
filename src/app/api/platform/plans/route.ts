import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return V.createPlan(actor, { code: String(b.code ?? ''), name: String(b.name ?? ''), staffSeats: Number(b.staffSeats), monthlyPricePaise: Number(b.monthlyPricePaise) }); });
