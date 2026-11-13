import { handler } from '@/server/http';
import * as S from '@/server/settlements';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor, params }) => S.runDetail(actor, params.id));
export const POST = handler(async (req, { actor, params }) => { const b = await req.json(); return b.action === 'approve' ? S.approveRun(actor, params.id, b.code) : S.initiateRun(actor, params.id, b.code); });
