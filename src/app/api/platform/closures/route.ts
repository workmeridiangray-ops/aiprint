import { handler } from '@/server/http';
import * as S from '@/server/storeadmin';
export const runtime = 'nodejs';
export const GET = handler(async (_req, { actor }) => S.listClosures(actor));
