import { handler } from '@/server/http';
import * as id from '@/server/identity';
import { getPortal } from '@/server/vendor';
export const runtime = 'nodejs';
export const POST = handler(async req => {
  const b = await req.json();
  const store = await getPortal(String(b.storeSlug ?? '')); // 404 for unknown or inactive stores
  return id.register(String(b.email ?? ''), String(b.password ?? ''), store.tenantId);
}, { public: true });
