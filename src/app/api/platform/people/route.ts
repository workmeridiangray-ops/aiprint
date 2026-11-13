import { handler } from '@/server/http';
import * as A from '@/server/platformadmin';
export const runtime = 'nodejs';
export const GET = handler(async (req, { actor }) => A.searchPeople(actor, req.nextUrl.searchParams.get('q') ?? ''));
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return b.action === 'unblock' ? A.unblockUser(actor, String(b.userId), b.reason) : A.blockUser(actor, String(b.userId), b.reason); });
