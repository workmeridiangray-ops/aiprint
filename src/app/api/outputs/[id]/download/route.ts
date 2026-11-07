import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { readOutput } from '@/server/worker';
import { verifyLink } from '@/server/downloadlink';
import { FORMATS } from '@/server/engine';
export const runtime = 'nodejs';
// Requires a short-lived link from POST /api/outputs/[id]/link, bound to this user. Access is re-checked on every use.
export const GET = handler(async (req, { actor, params }) => {
  verifyLink(new URL(req.url).searchParams.get('t'), params.id, actor.userId);
  const { buf, format } = await readOutput(actor, params.id);
  return new NextResponse(new Uint8Array(buf), { headers: { 'content-type': FORMATS[format as keyof typeof FORMATS].mime, 'content-disposition': `attachment; filename="artwork.${FORMATS[format as keyof typeof FORMATS].ext}"`, 'cache-control': 'private, no-store' } });
});
