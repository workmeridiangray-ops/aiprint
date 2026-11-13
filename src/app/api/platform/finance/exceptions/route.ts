import { handler } from '@/server/http';
import * as P from '@/server/payments';
export const runtime = 'nodejs';
export const GET = handler(async (req, { actor }) => P.listExceptions(actor, req.nextUrl.searchParams.get('status') ?? undefined));
