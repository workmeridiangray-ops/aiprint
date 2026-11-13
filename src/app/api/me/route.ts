import { handler } from '@/server/http';
import * as P from '@/server/payments';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => P.whoAmI(actor));
