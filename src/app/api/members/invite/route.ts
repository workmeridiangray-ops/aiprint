import { handler } from '@/server/http';
import { invite } from '@/server/identity';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return invite(actor, String(b.email ?? ''), String(b.role ?? '')); });
