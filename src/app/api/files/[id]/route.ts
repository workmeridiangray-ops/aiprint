import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { readOriginal } from '@/server/files';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor, params }) => {
  const buf = await readOriginal(actor, params.id);
  const png = buf[0] === 0x89;
  return new NextResponse(new Uint8Array(buf), { headers: { 'content-type': png ? 'image/png' : 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
});
