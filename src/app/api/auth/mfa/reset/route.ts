import { handler } from '@/server/http';
import { resetMfa } from '@/server/mfa';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => { const b = await req.json(); await resetMfa(actor, String(b.userId ?? ''), String(b.reason ?? '')); return { ok: true }; });
