import { handler } from '@/server/http';
import { regenerateRecoveryCodes } from '@/server/mfa';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => regenerateRecoveryCodes(actor, String((await req.json()).code ?? '')));
