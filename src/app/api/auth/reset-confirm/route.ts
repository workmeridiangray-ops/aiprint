import { handler } from '@/server/http';
import * as id from '@/server/identity';
export const runtime = 'nodejs';
export const POST = handler(async req => { const b = await req.json(); return id.resetPassword(String(b.token ?? ''), String(b.password ?? '')).then(() => ({ ok: true })); }, { public: true });
