import { handler } from '@/server/http';
import * as A from '@/server/platformadmin';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor, params }) => A.tenantDetail(actor, params.id));
export const POST = handler(async (req, { actor, params }) => { const b = await req.json(); return b.action === 'reactivate' ? A.reactivateTenant(actor, params.id, b.reason) : A.suspendTenant(actor, params.id, b.reason); });
