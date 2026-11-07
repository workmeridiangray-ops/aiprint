import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const POST = handler(async (_r, { actor, params }) => V.reserveCounter(actor, params.id));
