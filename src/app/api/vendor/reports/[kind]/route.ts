import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { runReport, reportCsv, type ReportKind } from '@/server/vendorreports';
export const runtime = 'nodejs';
export const GET = handler(async (req, { actor, params }) => {
  const q = new URL(req.url).searchParams; const f = { from: q.get('from') || undefined, to: q.get('to') || undefined, status: q.get('status') || undefined, channel: q.get('channel') || undefined, staffId: q.get('staffId') || undefined };
  if (q.get('format') === 'csv') return new NextResponse(await reportCsv(actor, params.kind as ReportKind, f), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${params.kind}.csv"`, 'cache-control': 'private, no-store' } });
  return runReport(actor, params.kind as ReportKind, f);
});
