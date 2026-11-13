import { handler } from '@/server/http';
import * as S from '@/server/settlements';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => S.listRuns(actor));
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return S.prepareRun(actor, String(b.period ?? '')); });
