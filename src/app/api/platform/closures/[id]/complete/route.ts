import { handler } from '@/server/http';
import * as S from '@/server/storeadmin';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => { const b = await req.json().catch(() => ({})); return S.completeClosure(actor, params.id, b.settlementNote); });
