import { handler } from '@/server/http';
import * as A from '@/server/platformadmin';
export const runtime = 'nodejs';
export const PATCH = handler(async (req, { actor, params }) => { const b = await req.json(); return A.changePlatformStaff(actor, params.id, { role: b.role, remove: b.remove === true }, b.code); });
export const DELETE = handler(async (_r, { actor, params }) => A.revokePlatformInvite(actor, params.id));
