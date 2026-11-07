import { handler } from '@/server/http';
import * as S from '@/server/storeadmin';
export const runtime = 'nodejs';
export const POST = handler(async (_req, { actor }) => S.cancelClosure(actor));
