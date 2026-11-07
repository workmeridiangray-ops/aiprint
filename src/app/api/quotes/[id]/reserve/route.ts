import { handler } from '@/server/http';
import { reserveQuote } from '@/server/quotes';
export const runtime = 'nodejs';
export const POST = handler(async (_r, { actor, params }) => reserveQuote(actor, params.id));
