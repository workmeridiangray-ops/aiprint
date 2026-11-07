import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { readOutput } from '@/server/worker';
import { FORMATS } from '@/server/engine';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor, params }) => {
  const { buf, format } = await readOutput(actor, params.id);
  return new NextResponse(new Uint8Array(buf), { headers: { 'content-type': FORMATS[format as keyof typeof FORMATS].mime, 'content-disposition': `attachment; filename="artwork.${FORMATS[format as keyof typeof FORMATS].ext}"`, 'cache-control': 'private, no-store' } });
});
