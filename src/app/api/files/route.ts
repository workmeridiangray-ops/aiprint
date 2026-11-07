import { handler } from '@/server/http';
import { saveOriginal } from '@/server/files';
import { AppError } from '@/server/db';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 26 * 1024 * 1024) throw new AppError('file_too_large', 'Images can be at most 25 MB', 413);
  const f = (await req.formData()).get('file');
  if (!(f instanceof File)) throw new AppError('invalid_request', 'Choose an image file');
  return saveOriginal(actor, Buffer.from(await f.arrayBuffer()));
});
