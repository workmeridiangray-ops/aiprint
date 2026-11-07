import { handler } from '@/server/http';
import * as id from '@/server/identity';
export const runtime = 'nodejs';
export const POST = handler(async req => { const b = await req.json(); return id.register(String(b.email ?? ''), String(b.password ?? ''), String(b.tenantId ?? '')); }, { public: true });
