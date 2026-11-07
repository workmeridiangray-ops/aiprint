import { handler } from '@/server/http';
import { jobStatus } from '@/server/worker';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor, params }) => jobStatus(actor, params.id));
