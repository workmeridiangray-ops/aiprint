import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const PATCH = handler(async (req, { actor }) => { const b = await req.json(); await V.updateBranding(actor, { displayName: b.displayName, primaryColour: b.primaryColour, supportEmail: b.supportEmail }); return { ok: true }; });
