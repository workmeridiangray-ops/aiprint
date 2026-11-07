import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { readOutput } from '@/server/worker';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor, params }) => {
  const { buf, format } = await readOutput(actor, params.id);
  return new NextResponse(new Uint8Array(buf), { headers: { 'content-type': `image/${format}`, 'content-disposition': `attachment; filename="artwork.${format}"`, 'cache-control': 'private, no-store' } });
});
