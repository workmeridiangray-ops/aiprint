import { handler } from '@/server/http';
import { publishPolicy } from '@/server/public';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return publishPolicy(actor, { slug: String(b.slug ?? ''), effectiveDate: String(b.effectiveDate ?? ''), body: String(b.body ?? ''), approvedByName: String(b.approvedByName ?? '') }); });
