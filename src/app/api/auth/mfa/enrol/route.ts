import { handler } from '@/server/http';
import { mfaStatus, startEnrolment, confirmEnrolment } from '@/server/mfa';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => mfaStatus(actor), { allowEnrolOnly: true });
export const POST = handler(async (_r, { actor }) => startEnrolment(actor), { allowEnrolOnly: true });
export const PUT = handler(async (req, { actor }) => confirmEnrolment(actor, String((await req.json()).code ?? '')), { allowEnrolOnly: true });
