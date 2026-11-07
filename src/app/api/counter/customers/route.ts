import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return V.createCounterCustomer(actor, String(b.name ?? ''), b.contact ? String(b.contact) : undefined); });
