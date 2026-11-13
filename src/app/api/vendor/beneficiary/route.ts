import { handler } from '@/server/http';
import * as S from '@/server/settlements';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => S.myBeneficiaries(actor));
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return S.requestBeneficiary(actor, { holderName: b.holderName, accountNumber: b.accountNumber, ifsc: b.ifsc, reason: b.reason }); });
