import { handler } from '@/server/http';
import * as S from '@/server/settlements';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => { const b = await req.json(); return b.action === 'verify' ? S.verifyBeneficiary(actor, params.id, b.verificationRef) : S.decideBeneficiary(actor, params.id, b.action === 'approve', b.note, b.code); });
