import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'node:crypto';
import { outputPixels, type Settings, MAX_OUTPUT_PIXELS } from './projects';
import { LIMITS } from './files';
import { placement } from '../lib/geometry';
import { enhanceImage, factorOf } from './enhance';
import { makeWatermarkedPreview } from './preview';
import { toCmykRaster, writeCmykTiff, drawCmykImage, readCmykFromPdf, readCmykTiffSamples, maxTotalInk, TAC_LIMIT_PERCENT } from './cmyk';

export const FORMATS = { png: { ext: 'png', mime: 'image/png' }, jpg: { ext: 'jpg', mime: 'image/jpeg' }, tiff: { ext: 'tif', mime: 'image/tiff' }, pdf: { ext: 'pdf', mime: 'application/pdf' } } as const;

/** Server-side export. Bleed is mirror replication of real pixels (no generative reconstruction). PNG/JPG are always RGB (sRGB); TIFF and PDF can be CMYK through the bundled FOGRA39 profile (src/server/cmyk.ts), with a 300% total-ink limit. No PDF/X claim.
 *  The browser preview is never used as export; both share src/lib/geometry.ts for placement. */
export async function renderExport(source: Buffer, s: Settings): Promise<Buffer> { return (await renderExportWithPreview(source, s)).file; }

/** Same export plus a watermarked, reduced-size preview built from the same composed image (so previews and files agree). The preview is null if it could not be made; the export never fails because of it. */
export async function renderExportWithPreview(source: Buffer, s: Settings): Promise<{ file: Buffer; preview: { jpeg: Buffer; width: number; height: number } | null }> {
  let full!: Buffer;
  const file = await renderCore(source, s, f => { full = f; });
  let preview = null; try { preview = await makeWatermarkedPreview(full); } catch (e) { console.error('preview failed', e); }
  return { file, preview };
}

async function renderCore(source: Buffer, s: Settings, onFull: (full: Buffer) => void): Promise<Buffer> {
  const { total } = outputPixels(s);
  const ef = factorOf(s.enhance);
  if (ef) source = await enhanceImage(await sharp(source, { limitInputPixels: LIMITS.maxPixels, failOn: 'error' }).rotate().toColourspace('srgb').ensureAlpha().png().toBuffer(), ef as 2 | 4); // same aspect, so placement is unchanged; more real pixels per mm
  if (total > MAX_OUTPUT_PIXELS) throw new Error('output exceeds 80 megapixels');
  const meta = await sharp(source, { limitInputPixels: LIMITS.maxPixels, failOn: 'error' }).metadata();
  const g = placement(meta.width!, meta.height!, s);
  if (g.trimW < 1 || g.trimH < 1) throw new Error('invalid trim size');

  let img = sharp(source, { limitInputPixels: LIMITS.maxPixels, failOn: 'error' }).rotate().toColourspace('srgb').ensureAlpha(); // honour EXIF, then user rotation below
  if (s.rotationDeg) img = sharp(await img.rotate(s.rotationDeg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer());
  let layer = await img.resize(g.nw, g.nh, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
  // Clip layer to the trim canvas (composite cannot take negative offsets).
  const x0 = Math.max(0, -g.left), y0 = Math.max(0, -g.top);
  const x1 = Math.min(g.nw, g.trimW - g.left), y1 = Math.min(g.nh, g.trimH - g.top);
  const canvas = sharp({ create: { width: g.trimW, height: g.trimH, channels: 3, background: '#ffffff' } });
  let trim: Buffer;
  if (x1 > x0 && y1 > y0) {
    layer = await sharp(layer).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
    trim = await canvas.composite([{ input: layer, left: g.left + x0, top: g.top + y0 }]).png().toBuffer();
  } else trim = await canvas.png().toBuffer();
  const full = g.bleed > 0
    ? await sharp(trim).extend({ top: g.bleed, bottom: g.bleed, left: g.bleed, right: g.bleed, extendWith: 'mirror' }).toBuffer()
    : trim;
  onFull(full);
  const base = sharp(full).flatten({ background: '#ffffff' }).withMetadata({ density: s.dpi });
  if (s.colour === 'cmyk') {
    const cm = await toCmykRaster(await sharp(full).flatten({ background: '#ffffff' }).removeAlpha().png().toBuffer());
    if (s.format === 'tiff') return writeCmykTiff(cm, s.dpi);
    if (s.format === 'pdf') {
      const doc = await PDFDocument.create();
      const mm = (v: number) => (v / 25.4) * 72;
      const wPt = mm(s.widthMm + 2 * s.bleedMm), hPt = mm(s.heightMm + 2 * s.bleedMm), b = mm(s.bleedMm);
      const page = doc.addPage([wPt, hPt]);
      drawCmykImage(doc, page, cm, wPt, hPt);
      page.setBleedBox(0, 0, wPt, hPt); page.setTrimBox(b, b, wPt - 2 * b, hPt - 2 * b);
      doc.setProducer('Artwork Studio'); doc.setCreationDate(new Date(0));
      return Buffer.from(await doc.save());
    }
    throw new Error('CMYK is available for TIFF and PDF only');
  }
  switch (s.format) {
    case 'jpg': return base.jpeg({ quality: 95, chromaSubsampling: '4:4:4' }).toBuffer();
    case 'tiff': return base.tiff({ compression: 'lzw' }).toBuffer();
    case 'pdf': {
      const png = await base.png().toBuffer();
      const doc = await PDFDocument.create();
      // Page and boxes use exact millimetres (not rounded pixel counts); the raster is scaled by under half a pixel to fill the page.
      const mm = (v: number) => (v / 25.4) * 72;
      const wPt = mm(s.widthMm + 2 * s.bleedMm), hPt = mm(s.heightMm + 2 * s.bleedMm), b = mm(s.bleedMm);
      const page = doc.addPage([wPt, hPt]);
      page.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: wPt, height: hPt });
      page.setBleedBox(0, 0, wPt, hPt); page.setTrimBox(b, b, wPt - 2 * b, hPt - 2 * b); // boxes only; no PDF/X claim
      doc.setProducer('Artwork Studio'); doc.setCreationDate(new Date(0));
      return Buffer.from(await doc.save());
    }
    default: return base.png().toBuffer();
  }
}

/** Independent output validation before any entitlement is created. */
export async function validateOutput(buf: Buffer, s: Settings) {
  const { w, h } = outputPixels(s);
  if (s.format === 'pdf') {
    if (buf.subarray(0, 5).toString() !== '%PDF-') throw new Error('output validation failed: not a PDF');
    const doc = await PDFDocument.load(buf);
    if (doc.getPageCount() !== 1) throw new Error('output validation failed: PDF must have one page');
    const { width, height } = doc.getPage(0).getSize();
    const mm = (v: number) => (v / 25.4) * 72;
    if (Math.abs(width - mm(s.widthMm + 2 * s.bleedMm)) > 0.05 || Math.abs(height - mm(s.heightMm + 2 * s.bleedMm)) > 0.05) throw new Error('output validation failed: PDF page size mismatch');
    if (s.colour === 'cmyk') {
      let c: ReturnType<typeof readCmykFromPdf>;
      try { c = readCmykFromPdf(doc); } catch { throw new Error('output validation failed: PDF has no CMYK image'); }
      if (!c.profileEmbedded) throw new Error('output validation failed: PDF image is not ICC-based CMYK');
      if (c.width !== w || c.height !== h || c.data.length !== w * h * 4) throw new Error('output validation failed: CMYK image size mismatch');
      if (maxTotalInk(c.data) > TAC_LIMIT_PERCENT + 1) throw new Error('output validation failed: total ink above limit');
    }
  } else if (s.colour === 'cmyk') {
    if (s.format !== 'tiff') throw new Error('output validation failed: CMYK needs TIFF or PDF');
    const meta = await sharp(buf, { limitInputPixels: MAX_OUTPUT_PIXELS }).metadata(); // libvips must be able to open it
    if (meta.format !== 'tiff' || meta.space !== 'cmyk' || meta.width !== w || meta.height !== h || !meta.hasProfile) throw new Error(`output validation failed: CMYK TIFF is ${meta.format}/${meta.space} ${meta.width}x${meta.height}, profile ${meta.hasProfile}`);
    let t: ReturnType<typeof readCmykTiffSamples>;
    try { t = readCmykTiffSamples(buf); } catch { throw new Error('output validation failed: CMYK TIFF cannot be read'); }
    if (t.samples !== 4 || t.photometric !== 5 || !t.hasProfile || t.data.length !== w * h * 4) throw new Error('output validation failed: CMYK channel layout');
    if (maxTotalInk(t.data) > TAC_LIMIT_PERCENT + 1) throw new Error('output validation failed: total ink above limit');
  } else {
    const want = s.format === 'jpg' ? 'jpeg' : s.format;
    const m = await sharp(buf, { limitInputPixels: MAX_OUTPUT_PIXELS }).metadata();
    if (m.format !== want || m.width !== w || m.height !== h) throw new Error(`output validation failed: got ${m.format} ${m.width}x${m.height}, expected ${want} ${w}x${h}`);
    if (m.channels && m.channels > 4) throw new Error('output validation failed: unexpected channels');
    await sharp(buf, { limitInputPixels: MAX_OUTPUT_PIXELS }).resize(16, 16, { fit: 'inside' }).raw().toBuffer();
  }
  return { format: s.format, colour: s.colour, width: w, height: h, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}
