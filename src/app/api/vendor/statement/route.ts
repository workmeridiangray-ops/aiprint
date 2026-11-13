import { handler } from '@/server/http';
import * as S from '@/server/settlements';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => S.vendorStatement(actor));
