import { handler } from '@/server/http';
import * as S from '@/server/storeadmin';
export const runtime = 'nodejs';
export const GET = handler(async (_req, { actor }) => S.getSettings(actor));
export const PUT = handler(async (req, { actor }) => { const b = await req.json(); return S.saveSettings(actor, { billingContactName: b.billingContactName, billingEmail: b.billingEmail, supportEmail: b.supportEmail, supportPhone: b.supportPhone, requireStaffMfa: b.requireStaffMfa }, Number(b.expectedVersion)); });
