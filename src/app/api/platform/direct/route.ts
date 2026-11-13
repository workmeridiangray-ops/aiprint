import { handler } from '@/server/http';
import * as A from '@/server/platformadmin';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => A.directStore(actor));
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return A.setDirectPrice(actor, Number(b.perMpPaise), Number(b.minPaise)); });
