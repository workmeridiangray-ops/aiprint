import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { requestExport, downloadExport } from '@/server/account';
export const runtime = 'nodejs';
export const POST = handler(async (_r, { actor }) => requestExport(actor));
export const GET = handler(async (req, { actor }) => {
  const data = await downloadExport(actor, req.nextUrl.searchParams.get('id') ?? '');
  return new NextResponse(JSON.stringify(data, null, 2), { headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="my-account-data.json"', 'cache-control': 'no-store' } });
});
