import { handler } from '@/server/http';
import * as C from '@/server/claims';
export const runtime = 'nodejs';
export const PATCH = handler(async (req, { actor, params }) => { const b = await req.json().catch(() => ({})); return C.correctCounterContact(actor, params.id, b.contact, b.reason); });
