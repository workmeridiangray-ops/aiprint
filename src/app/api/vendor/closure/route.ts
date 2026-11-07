import { handler } from '@/server/http';
import * as S from '@/server/storeadmin';
export const runtime = 'nodejs';
export const GET = handler(async (_req, { actor }) => S.closureStatus(actor));
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return S.requestClosure(actor, String(b.reason ?? '')); });
