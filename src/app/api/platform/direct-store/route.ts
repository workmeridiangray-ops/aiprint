import { handler } from '@/server/http';
import { createDirectStore } from '@/server/public';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return createDirectStore(actor, String(b.name ?? ''), String(b.slug ?? '')); });
