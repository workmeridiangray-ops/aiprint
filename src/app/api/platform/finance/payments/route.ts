import { handler } from '@/server/http';
import * as P from '@/server/payments';
export const runtime = 'nodejs';
export const GET = handler(async (req, { actor }) => { const q = req.nextUrl.searchParams; return P.listPayments(actor, { status: q.get('status') ?? undefined, q: q.get('q') ?? undefined }); });
