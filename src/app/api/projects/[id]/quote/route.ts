import { handler } from '@/server/http';
import { createQuote } from '@/server/quotes';
export const runtime = 'nodejs';
export const POST = handler(async (_r, { actor, params }) => createQuote(actor, params.id));
