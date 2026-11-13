import { handler } from '@/server/http';
import * as A from '@/server/platformadmin';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => { const b = await req.json(); return A.advanceIncident(actor, params.id, b); });
