import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { outputPixels, type Settings, MAX_OUTPUT_PIXELS } from './projects';
import { LIMITS } from './files';

const px = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);

/** Server-side export. Edge bleed uses mirror replication of real pixels (no generative reconstruction).
 *  Output is flattened RGB PNG with density metadata. The browser preview is never used as export. */
export async function renderExport(source: Buffer, s: Settings): Promise<Buffer> {
  const { w, h, total } = outputPixels(s);
  if (total > MAX_OUTPUT_PIXELS) throw new Error('output exceeds 80 megapixels');
  const bleed = px(s.bleedMm, s.dpi);
  const trimW = w - 2 * bleed, trimH = h - 2 * bleed;
  if (trimW < 1 || trimH < 1) throw new Error('invalid trim size');
  const trim = await sharp(source, { limitInputPixels: LIMITS.maxPixels, failOn: 'error' })
    .rotate(s.rotationDeg || 0, { background: '#ffffff' })
    .flatten({ background: '#ffffff' })
    .toColourspace('srgb')
    .resize(trimW, trimH, { fit: s.fit === 'fill' ? 'cover' : 'contain', background: '#ffffff', kernel: 'lanczos3' })
    .png().toBuffer();
  const out = bleed > 0
    ? await sharp(trim).extend({ top: bleed, bottom: bleed, left: bleed, right: bleed, extendWith: 'mirror' }).withMetadata({ density: s.dpi }).png().toBuffer()
    : await sharp(trim).withMetadata({ density: s.dpi }).png().toBuffer();
  return out;
}

/** Independent output validation before any entitlement is created. */
export async function validateOutput(buf: Buffer, s: Settings) {
  const { w, h } = outputPixels(s);
  const m = await sharp(buf, { limitInputPixels: MAX_OUTPUT_PIXELS }).metadata();
  if (m.format !== 'png' || m.width !== w || m.height !== h) throw new Error(`output validation failed: got ${m.format} ${m.width}x${m.height}, expected png ${w}x${h}`);
  await sharp(buf, { limitInputPixels: MAX_OUTPUT_PIXELS }).resize(16, 16, { fit: 'inside' }).raw().toBuffer(); // full decode check
  return { format: 'png' as const, width: w, height: h, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}
