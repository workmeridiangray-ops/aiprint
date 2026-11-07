import { handler } from '@/server/http';
import * as id from '@/server/identity';
export const runtime = 'nodejs';
export const POST = handler(async req => { const b = await req.json(); return id.verifyEmail(String(b.token ?? '')).then(() => ({ ok: true })); }, { public: true });
