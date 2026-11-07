import { handler } from '@/server/http';
import { updateEnquiry } from '@/server/public';
export const runtime = 'nodejs';
export const PATCH = handler(async (req, { actor, params }) => { const b = await req.json(); await updateEnquiry(actor, params.id, { status: b.status, resolution: b.resolution }); return { ok: true }; });
