import { handler } from '@/server/http';
import * as A from '@/server/platformadmin';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => A.listIncidents(actor));
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return A.recordIncident(actor, b); });
