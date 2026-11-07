import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => V.listStaff(actor));
