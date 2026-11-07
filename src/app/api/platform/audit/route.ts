import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { searchAudit } from '@/server/admin';
export const runtime = 'nodejs';
export const GET = handler(async (req, { actor }) => {
  const q = new URL(req.url).searchParams; const g = (k: string) => q.get(k) || undefined;
  return NextResponse.json(await searchAudit(actor, { action: g('action'), tenantId: g('tenantId'), outcome: g('outcome'), from: g('from'), to: g('to'), before: g('before') ? Number(g('before')) : undefined, limit: g('limit') ? Number(g('limit')) : undefined }));
});
