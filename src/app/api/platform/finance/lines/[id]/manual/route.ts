import { handler } from '@/server/http';
import * as S from '@/server/settlements';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => { const b = await req.json(); return S.recordManualTransfer(actor, params.id, b.reference, b.code); });
