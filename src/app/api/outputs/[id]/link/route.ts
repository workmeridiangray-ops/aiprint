import { handler } from '@/server/http';
import { issueDownloadLink } from '@/server/downloadlink';
export const runtime = 'nodejs';
export const POST = handler(async (_r, { actor, params }) => issueDownloadLink(actor, params.id));
