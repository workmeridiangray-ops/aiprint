import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { renderExport, validateOutput } from '../src/server/engine';
import { validateSettings } from '../src/server/projects';
import { toCmykRaster, writeCmykTiff, readCmykTiffSamples, readCmykFromPdf, maxTotalInk, TAC_LIMIT_PERCENT } from '../src/server/cmyk';

const solid = (c: string, w = 400, h = 200) => sharp({ create: { width: w, height: h, channels: 3, background: c } }).png().toBuffer();
const twoHalves = async () => sharp({ create: { width: 400, height: 200, channels: 3, background: '#0000ff' } }).composite([{ input: await solid('#ff0000', 200, 200), left: 0, top: 0 }]).png().toBuffer();
const base = { widthMm: 25.4, heightMm: 25.4, bleedMm: 0, dpi: 100, fit: 'fill' as const };
const S = (o: object = {}) => validateSettings({ ...base, ...o });
const at = (d: Uint8Array, w: number, x: number, y: number) => [...d.subarray((y * w + x) * 4, (y * w + x) * 4 + 4)];

describe('CMYK settings', () => {
  it('default is RGB; CMYK only with TIFF or PDF', () => {
    expect(S().colour).toBe('rgb');
    expect(S({ format: 'tiff', colour: 'cmyk' }).colour).toBe('cmyk');
    expect(S({ format: 'pdf', colour: 'cmyk' }).colour).toBe('cmyk');
    expect(() => S({ format: 'png', colour: 'cmyk' })).toThrow(/TIFF and PDF only/);
    expect(() => S({ format: 'jpg', colour: 'cmyk' })).toThrow(/TIFF and PDF only/);
    expect(() => S({ colour: 'lab' })).toThrow();
  });
});

describe('CMYK conversion is a real profile conversion', () => {
  it('white has no ink; red is magenta+yellow; blue is cyan+magenta', async () => {
    const white = await toCmykRaster(await solid('#ffffff', 8, 8));
    expect(at(white.data, 8, 3, 3)).toEqual([0, 0, 0, 0]);
    const red = at((await toCmykRaster(await solid('#ff0000', 8, 8))).data, 8, 3, 3);
    expect(red[0]).toBeLessThan(25); expect(red[1]).toBeGreaterThan(200); expect(red[2]).toBeGreaterThan(200);
    const blue = at((await toCmykRaster(await solid('#0000ff', 8, 8))).data, 8, 3, 3);
    expect(blue[0]).toBeGreaterThan(200); expect(blue[1]).toBeGreaterThan(150); expect(blue[2]).toBeLessThan(25);
  });
  it('RGB black would exceed 300% total ink; the limit brings it down and counts the pixels it changed', async () => {
    const black = await toCmykRaster(await solid('#000000', 8, 8));
    expect(black.limitedPixels).toBe(64);
    expect(maxTotalInk(black.data)).toBeLessThanOrEqual(TAC_LIMIT_PERCENT);
    expect(at(black.data, 8, 0, 0)[3]).toBeGreaterThan(200); // black stays heavy on the K plate
  });
});

describe('CMYK TIFF export', () => {
  it('is a CMYK TIFF with profile, density, exact size, and validates', async () => {
    const s = S({ format: 'tiff', colour: 'cmyk', bleedMm: 2.54, dpi: 100 });
    const o = await renderExport(await twoHalves(), s);
    const m = await sharp(o).metadata();
    expect(m.format).toBe('tiff'); expect(m.space).toBe('cmyk'); expect(m.channels).toBe(4); expect(m.hasProfile).toBe(true); expect(m.density).toBe(100);
    const v = await validateOutput(o, s);
    expect(v.colour).toBe('cmyk'); expect(v.width).toBe(m.width); expect(v.sha256).toHaveLength(64);
  });
  it('keeps the image geometry: red on the left half, blue on the right', async () => {
    const s = S({ format: 'tiff', colour: 'cmyk' });
    const t = readCmykTiffSamples(await renderExport(await twoHalves(), s));
    const w = t.width;
    const l = at(t.data, w, 5, 50), r = at(t.data, w, w - 6, 50);
    expect(l[1]).toBeGreaterThan(200); expect(l[0]).toBeLessThan(25);
    expect(r[0]).toBeGreaterThan(200); expect(r[2]).toBeLessThan(25);
  });
  it('validation rejects a CMYK file with too much ink, and RGB files claimed as CMYK', async () => {
    const s = S({ format: 'tiff', colour: 'cmyk' });
    const over = writeCmykTiff({ data: Buffer.alloc(s.dpi * 4 * s.dpi, 255), width: 100, height: 100, limitedPixels: 0 }, 100);
    await expect(validateOutput(over, s)).rejects.toThrow(/total ink/);
    const rgbTiff = await renderExport(await twoHalves(), S({ format: 'tiff' }));
    await expect(validateOutput(rgbTiff, s)).rejects.toThrow(/validation failed/);
  });
  it('an RGB export is unchanged by the new setting (still sRGB, 3 channels)', async () => {
    const o = await renderExport(await twoHalves(), S({ format: 'tiff' }));
    const m = await sharp(o).metadata(); expect(m.space).toBe('srgb'); expect(m.channels).toBe(3);
  });
});

describe('CMYK PDF export', () => {
  it('has one page, exact trim/bleed boxes, a lossless ICC-based CMYK image, and validates', async () => {
    const s = S({ format: 'pdf', colour: 'cmyk', bleedMm: 2.54, dpi: 200 });
    const o = await renderExport(await twoHalves(), s);
    const doc = await PDFDocument.load(o);
    expect(doc.getPageCount()).toBe(1);
    const pg = doc.getPage(0); expect(Math.round(pg.getTrimBox().width)).toBe(72);
    const c = readCmykFromPdf(doc);
    expect(c.profileEmbedded).toBe(true); expect(c.channels).toBe(4);
    expect(maxTotalInk(c.data)).toBeLessThanOrEqual(TAC_LIMIT_PERCENT);
    await validateOutput(o, s);
    expect(o.subarray(0, 5).toString()).toBe('%PDF-');
    expect(o.toString('latin1')).not.toContain('PDF/X'); // no certification claim
  });
  it('validation rejects an RGB PDF when CMYK was requested', async () => {
    const rgbPdf = await renderExport(await twoHalves(), S({ format: 'pdf' }));
    await expect(validateOutput(rgbPdf, S({ format: 'pdf', colour: 'cmyk' }))).rejects.toThrow(/validation failed/);
  });
});
