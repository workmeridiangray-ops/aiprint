import { handler } from '@/server/http';
import { enhancePreview } from '@/server/enhance';
import { AppError } from '@/server/db';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => {
  const b = await req.json().catch(() => ({}));
  const f = b.enhance === '4x' ? 4 : b.enhance === '2x' ? 2 : 0;
  if (!f) throw new AppError('invalid_request', 'enhance must be "2x" or "4x"');
  return enhancePreview(actor, params.id, f as 2 | 4);
});
