import { handler } from '@/server/http';
import { listEnquiries } from '@/server/public';
export const runtime = 'nodejs';
export const GET = handler(async (req, { actor }) => listEnquiries(actor, req.nextUrl.searchParams.get('status') ?? undefined));
