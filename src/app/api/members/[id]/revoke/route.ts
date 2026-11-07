import { handler } from '@/server/http';
import { revokeMembership } from '@/server/identity';
export const runtime = 'nodejs';
export const POST = handler(async (_r, { actor, params }) => revokeMembership(actor, params.id).then(() => ({ ok: true })));
