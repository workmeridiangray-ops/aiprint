import { handler } from '@/server/http';
import * as P from '@/server/payments';
export const runtime = 'nodejs';
export const POST = handler(async (_r, { actor, params }) => P.financeSync(actor, params.id));
