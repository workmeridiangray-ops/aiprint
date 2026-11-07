import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { readPreview } from '@/server/worker';
export const runtime = 'nodejs';
// Watermarked, reduced-size preview only. The clean file is served by ../download and needs a signed link.
export const GET = handler(async (_req, { actor, params }) => {
  const jpeg = await readPreview(actor, params.id);
  return new NextResponse(new Uint8Array(jpeg), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-disposition': 'inline; filename="preview.jpg"' } });
});
