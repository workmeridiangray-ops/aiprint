import { handler } from '@/server/http';
import { disableMfa } from '@/server/mfa';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => { await disableMfa(actor, String((await req.json()).code ?? '')); return { ok: true }; });
