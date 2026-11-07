import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return V.createCounterProject(actor, String(b.counterCustomerId ?? ''), String(b.name ?? '')); });
