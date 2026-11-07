import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const GET = handler(async (req, { actor }) => { const q = new URL(req.url).searchParams; return V.listCustomers(actor, { q: q.get('q') || undefined, cursor: q.get('cursor') || undefined, limit: q.get('limit') ? Number(q.get('limit')) : undefined }); });
