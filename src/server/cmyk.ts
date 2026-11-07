import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFNumber, PDFDict, PDFArray, PDFRawStream, PDFPage, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject, decodePDFRawStream } from 'pdf-lib';

/** CMYK export: sRGB -> FOGRA39 through lcms (libvips, its default rendering intent), then a disclosed total-ink limit.
 *  PDF/X conformance is NOT claimed (the quotation excludes it). */
export const CMYK_PROFILE_NAME = 'FOGRA39L Coated';
export const CMYK_PROFILE_PATH = path.join(process.cwd(), 'assets', 'profiles', 'FOGRA39.icc');
export const TAC_LIMIT_PERCENT = 300;
let profileBytes: Buffer | null = null;
export function cmykProfile(): Buffer { return (profileBytes ??= fs.readFileSync(CMYK_PROFILE_PATH)); }

export type CmykRaster = { data: Buffer; width: number; height: number; limitedPixels: number };

/** Convert a flattened RGB image to raw interleaved CMYK (0 = no ink, 255 = full ink), then cap total ink.
 *  Where C+M+Y+K exceeds the limit, cyan/magenta/yellow are scaled down together and black is kept. */
export async function toCmykRaster(rgbFlat: Buffer): Promise<CmykRaster> {
  const out = await sharp(rgbFlat).withIccProfile(CMYK_PROFILE_PATH).toColourspace('cmyk').raw().toBuffer({ resolveWithObject: true });
  if (out.info.channels !== 4) throw new Error(`CMYK conversion produced ${out.info.channels} channels`);
  const d = out.data, limit = Math.floor((TAC_LIMIT_PERCENT / 100) * 255);
  let limited = 0;
  for (let i = 0; i < d.length; i += 4) {
    const sum = d[i] + d[i + 1] + d[i + 2] + d[i + 3];
    if (sum <= limit) continue;
    const cmy = d[i] + d[i + 1] + d[i + 2], k = Math.max(0, cmy - (sum - limit)) / cmy;
    d[i] = Math.floor(d[i] * k); d[i + 1] = Math.floor(d[i + 1] * k); d[i + 2] = Math.floor(d[i + 2] * k);
    limited++;
  }
  return { data: d, width: out.info.width, height: out.info.height, limitedPixels: limited };
}

/** Highest total ink (percent of 400) found in raw CMYK data; the limit above is compared against this. */
export function maxTotalInk(d: Uint8Array): number {
  let m = 0;
  for (let i = 0; i + 3 < d.length; i += 4) { const s = d[i] + d[i + 1] + d[i + 2] + d[i + 3]; if (s > m) m = s; }
  return Math.round((m / 255) * 100);
}

/** Baseline CMYK TIFF: Photometric=Separated, 8 bits, deflate strips, ICC profile embedded, resolution tags. */
export function writeCmykTiff(r: CmykRaster, dpi: number): Buffer {
  const { data, width: w, height: h } = r;
  const rowBytes = w * 4, rowsPerStrip = Math.max(1, Math.floor((1 << 20) / rowBytes));
  const strips: Buffer[] = [];
  for (let y = 0; y < h; y += rowsPerStrip) strips.push(zlib.deflateSync(data.subarray(y * rowBytes, Math.min(h, y + rowsPerStrip) * rowBytes), { level: 6 }));
  const icc = cmykProfile(), n = strips.length, entries = 15, ifdSize = 2 + entries * 12 + 4;
  const even = (x: number) => x + (x & 1);
  let off = 8; const stripOffsets: number[] = [];
  for (const s of strips) { stripOffsets.push(off); off += even(s.length); }
  const ifdOff = off; off += ifdSize;
  const bpsOff = off; off += 8; const xresOff = off; off += 8; const yresOff = off; off += 8;
  const offArr = off; off += n * 4; const cntArr = off; off += n * 4;
  const iccOff = off; off += even(icc.length);
  const out = Buffer.alloc(off);
  out.write('II', 0); out.writeUInt16LE(42, 2); out.writeUInt32LE(ifdOff, 4);
  strips.forEach((s, i) => s.copy(out, stripOffsets[i]));
  let p = ifdOff; out.writeUInt16LE(entries, p); p += 2;
  const ent = (tag: number, type: number, count: number, value: number) => { out.writeUInt16LE(tag, p); out.writeUInt16LE(type, p + 2); out.writeUInt32LE(count, p + 4); if (type === 3 && count === 1) out.writeUInt16LE(value, p + 8); else out.writeUInt32LE(value, p + 8); p += 12; };
  ent(256, 4, 1, w); ent(257, 4, 1, h); ent(258, 3, 4, bpsOff); ent(259, 3, 1, 8); ent(262, 3, 1, 5);
  ent(273, 4, n, n === 1 ? stripOffsets[0] : offArr); ent(277, 3, 1, 4); ent(278, 4, 1, rowsPerStrip);
  ent(279, 4, n, n === 1 ? strips[0].length : cntArr); ent(282, 5, 1, xresOff); ent(283, 5, 1, yresOff);
  ent(284, 3, 1, 1); ent(296, 3, 1, 2); ent(332, 3, 1, 1); ent(34675, 7, icc.length, iccOff);
  for (let i = 0; i < 4; i++) out.writeUInt16LE(8, bpsOff + i * 2);
  out.writeUInt32LE(dpi, xresOff); out.writeUInt32LE(1, xresOff + 4); out.writeUInt32LE(dpi, yresOff); out.writeUInt32LE(1, yresOff + 4);
  strips.forEach((s, i) => { out.writeUInt32LE(stripOffsets[i], offArr + i * 4); out.writeUInt32LE(s.length, cntArr + i * 4); });
  icc.copy(out, iccOff);
  return out;
}

/** Draw the raw CMYK raster on a page as one lossless (Flate) ICCBased image covering the whole page. */
export function drawCmykImage(doc: PDFDocument, page: PDFPage, r: CmykRaster, widthPt: number, heightPt: number): void {
  const ctx = doc.context;
  const iccRef = ctx.register(ctx.flateStream(cmykProfile(), { N: PDFNumber.of(4), Alternate: PDFName.of('DeviceCMYK') }));
  const imgRef = ctx.register(ctx.flateStream(r.data, {
    Type: PDFName.of('XObject'), Subtype: PDFName.of('Image'), Width: PDFNumber.of(r.width), Height: PDFNumber.of(r.height),
    BitsPerComponent: PDFNumber.of(8), ColorSpace: ctx.obj([PDFName.of('ICCBased'), iccRef]),
  }));
  const res = page.node.Resources() as PDFDict;
  let xo = res.lookup(PDFName.of('XObject')) as PDFDict | undefined;
  if (!xo) { xo = ctx.obj({}) as PDFDict; res.set(PDFName.of('XObject'), xo); }
  xo.set(PDFName.of('Im0'), imgRef);
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(widthPt, 0, 0, heightPt, 0, 0), drawObject('Im0'), popGraphicsState());
}

/** Read back the CMYK image from a PDF produced by drawCmykImage (independent of how it was written). */
export function readCmykFromPdf(doc: PDFDocument): { width: number; height: number; channels: number; profileEmbedded: boolean; data: Uint8Array } {
  const res = doc.getPage(0).node.Resources() as PDFDict;
  const xo = res.lookup(PDFName.of('XObject'), PDFDict);
  const s = doc.context.lookup(xo.get(PDFName.of('Im0'))) as unknown as PDFRawStream;
  const cs = s.dict.lookup(PDFName.of('ColorSpace'), PDFArray);
  const prof = doc.context.lookup(cs.get(1)) as unknown as PDFRawStream;
  const n = (prof.dict.get(PDFName.of('N')) as PDFNumber).asNumber();
  return {
    width: (s.dict.get(PDFName.of('Width')) as PDFNumber).asNumber(), height: (s.dict.get(PDFName.of('Height')) as PDFNumber).asNumber(),
    channels: n, profileEmbedded: String(cs.get(0)) === '/ICCBased' && n === 4, data: decodePDFRawStream(s).decode(),
  };
}

/** Read the stored CMYK samples straight from the TIFF bytes (baseline, little-endian, deflate or no compression).
 *  libvips applies the embedded profile when it opens a CMYK TIFF, so its pixel readback is not the stored ink values; this reads the file itself. */
export function readCmykTiffSamples(buf: Buffer): { width: number; height: number; samples: number; photometric: number; hasProfile: boolean; data: Buffer } {
  if (buf.length < 16 || buf.toString('latin1', 0, 2) !== 'II' || buf.readUInt16LE(2) !== 42) throw new Error('not a little-endian TIFF');
  const ifd = buf.readUInt32LE(4), n = buf.readUInt16LE(ifd);
  const tags = new Map<number, { type: number; count: number; at: number }>();
  for (let i = 0; i < n; i++) { const o = ifd + 2 + i * 12; tags.set(buf.readUInt16LE(o), { type: buf.readUInt16LE(o + 2), count: buf.readUInt32LE(o + 4), at: o + 8 }); }
  const one = (tag: number) => { const e = tags.get(tag); if (!e) return 0; return e.type === 3 ? buf.readUInt16LE(e.at) : buf.readUInt32LE(e.at); };
  const list = (tag: number) => { const e = tags.get(tag)!; const size = e.type === 3 ? 2 : 4; const base = e.count * size <= 4 ? e.at : buf.readUInt32LE(e.at); return Array.from({ length: e.count }, (_, i) => (size === 2 ? buf.readUInt16LE(base + i * 2) : buf.readUInt32LE(base + i * 4))); };
  const comp = one(259); if (comp !== 8 && comp !== 1) throw new Error('unsupported TIFF compression');
  const offs = list(273), cnts = list(279);
  const parts = offs.map((o, i) => { const raw = buf.subarray(o, o + cnts[i]); return comp === 8 ? zlib.inflateSync(raw) : raw; });
  return { width: one(256), height: one(257), samples: one(277), photometric: one(262), hasProfile: tags.has(34675), data: Buffer.concat(parts) };
}
