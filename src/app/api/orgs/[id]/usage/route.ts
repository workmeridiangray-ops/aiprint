import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import * as O from '@/server/org';
export const runtime = 'nodejs';
export const GET = handler(async (req, { actor, params }) => {
  const q = req.nextUrl.searchParams; const f = { from: q.get('from') ?? undefined, to: q.get('to') ?? undefined, memberId: q.get('memberId') ?? undefined };
  if (q.get('format') === 'csv') return new NextResponse(await O.usageCsv(actor, params.id, f), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="usage.csv"', 'cache-control': 'private, no-store' } });
  return O.usageReport(actor, params.id, f);
});
