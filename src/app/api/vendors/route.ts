import { handler } from '@/server/http';
import * as V from '@/server/vendor';
export const runtime = 'nodejs';
export const POST = handler(async req => { const b = await req.json(); return V.createVendor({ email: String(b.email ?? ''), password: String(b.password ?? ''), businessName: String(b.businessName ?? ''), slug: String(b.slug ?? '') }); }, { public: true });
