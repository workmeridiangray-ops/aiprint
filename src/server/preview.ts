import sharp from 'sharp';

/** Watermarked preview: at most 1000 px on the long side, JPEG, tiled diagonal "PREVIEW" text. Never the production file.
 *  The text is drawn with the server's DejaVu Sans (the Docker image installs fonts-dejavu-core). */
export const PREVIEW_MAX_PX = 1000;
export const WATERMARK_TEXT = 'PREVIEW';

export async function makeWatermarkedPreview(rgb: Buffer): Promise<{ jpeg: Buffer; width: number; height: number }> {
  const small = await sharp(rgb).flatten({ background: '#ffffff' }).removeAlpha().resize(PREVIEW_MAX_PX, PREVIEW_MAX_PX, { fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const { width, height } = await sharp(small).metadata();
  const w = width!, h = height!, step = Math.max(110, Math.round(Math.min(w, h) / 4)), fs = Math.round(step * 0.34);
  const tiles: string[] = [];
  for (let y = -step; y < h + step; y += step) for (let x = -step; x < w + step; x += step * 2.4) {
    tiles.push(`<text x="${Math.round(x + ((y / step) % 2 ? step * 0.85 : 0))}" y="${y}" transform="rotate(-28 ${Math.round(x)} ${y})" font-size="${fs}" font-family="DejaVu Sans, sans-serif" font-weight="bold" fill="#ffffff" fill-opacity="0.55" stroke="#000000" stroke-opacity="0.45" stroke-width="${Math.max(1, Math.round(fs / 28))}">${WATERMARK_TEXT}</text>`);
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${tiles.join('')}</svg>`);
  const jpeg = await sharp(small).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality: 78 }).toBuffer();
  return { jpeg, width: w, height: h };
}

/** True when the watermark visibly changes the picture (guards against a server without the font drawing nothing). */
export async function watermarkVisible(): Promise<boolean> {
  const flat = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#808080' } }).png().toBuffer();
  const { jpeg } = await makeWatermarkedPreview(flat);
  const px = await sharp(jpeg).raw().toBuffer();
  let off = 0; for (let i = 0; i < px.length; i++) if (Math.abs(px[i] - 128) > 20) off++;
  return off > px.length * 0.01;
}
