import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { renderExport, validateOutput } from '../src/server/engine';
import { validateSettings } from '../src/server/projects';
import { placement, dpiLevel } from '../src/lib/geometry';

// Source: left half red, right half blue, 400x200.
const src = async () => sharp({ create: { width: 400, height: 200, channels: 3, background: '#0000ff' } })
  .composite([{ input: await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ff0000' } }).png().toBuffer(), left: 0, top: 0 }]).png().toBuffer();
const base = { widthMm: 25.4, heightMm: 25.4, bleedMm: 0, dpi: 100, fit: 'fill' as const };
const S = (o: object = {}) => validateSettings({ ...base, ...o });
async function px(buf: Buffer, x: number, y: number) { const { data } = await sharp(buf).raw().toBuffer({ resolveWithObject: true }); const w = (await sharp(buf).metadata()).width!; const ch = (await sharp(buf).metadata()).channels!; const i = (y * w + x) * ch; return [data[i], data[i + 1], data[i + 2]]; }
const isRed = (c: number[]) => c[0] > 200 && c[2] < 60, isBlue = (c: number[]) => c[2] > 200 && c[0] < 60, isWhite = (c: number[]) => c.every(v => v > 240);

describe('placement geometry', () => {
  it('fill covers the trim; fit contains it', () => {
    const f = placement(400, 200, S()), t = placement(400, 200, S({ fit: 'fit' }));
    expect(f.nh).toBe(f.trimH); expect(f.nw).toBeGreaterThan(f.trimW);
    expect(t.nw).toBe(t.trimW); expect(t.nh).toBeLessThan(t.trimH);
  });
  it('effective dpi falls as the image is enlarged, and is classified', () => {
    const a = placement(1000, 1000, S({ widthMm: 254, heightMm: 254, dpi: 300 })); // 1000px over 10in
    expect(Math.round(a.effectiveDpi)).toBe(100); expect(dpiLevel(a.effectiveDpi)).toBe('low');
    expect(dpiLevel(300)).toBe('good');
  });
});

describe('transforms in the real export', () => {
  it('fill centred: shows the middle of the image (red|blue split at centre)', async () => {
    const o = await renderExport(await src(), S());
    expect(isRed(await px(o, 5, 50))).toBe(true); expect(isBlue(await px(o, 95, 50))).toBe(true);
  });
  it('offset moves the image: shifting right by 12.7mm pushes red toward the right half', async () => {
    const o = await renderExport(await src(), S({ offsetXMm: 12.7, scale: 2 }));
    // scale 2, centred: 400px source -> 400px render in 100px trim shows centre 100px; shift right 50px reveals more red on left
    expect(isRed(await px(o, 70, 50))).toBe(true);
  });
  it('fit leaves white margins; rotation by 180 swaps the halves', async () => {
    const fit = await renderExport(await src(), S({ fit: 'fit' }));
    expect(isWhite(await px(fit, 50, 5))).toBe(true);
    const rot = await renderExport(await src(), S({ rotationDeg: 180 }));
    expect(isBlue(await px(rot, 5, 50))).toBe(true); expect(isRed(await px(rot, 95, 50))).toBe(true);
  });
  it('image moved fully off the trim yields white, not a crash', async () => {
    const o = await renderExport(await src(), S({ offsetXMm: 500, fit: 'fit' }));
    expect(isWhite(await px(o, 50, 50))).toBe(true);
  });
  it('bleed mirrors real edge pixels (outer ring matches the adjacent inside pixels)', async () => {
    const s = S({ bleedMm: 2.54 }); // 10px
    const o = await renderExport(await src(), s); const m = await sharp(o).metadata();
    expect([m.width, m.height]).toEqual([120, 120]);
    expect(isRed(await px(o, 9, 60))).toBe(true); // bleed side mirrors red at left edge
    expect(isBlue(await px(o, 110, 60))).toBe(true);
  });
});

describe('formats', () => {
  for (const f of ['png', 'jpg', 'tiff', 'pdf'] as const) it(`${f} exports validate`, async () => {
    const s = S({ format: f, bleedMm: 2.54, dpi: 200 });
    const o = await renderExport(await src(), s); const v = await validateOutput(o, s);
    expect(v.sha256).toHaveLength(64);
    if (f !== 'pdf') expect((await sharp(o).metadata()).density).toBe(200);
  });
  it('pdf is a single flattened page with trim and bleed boxes', async () => {
    const s = S({ format: 'pdf', bleedMm: 2.54, dpi: 200 });
    const doc = await PDFDocument.load(await renderExport(await src(), s));
    expect(doc.getPageCount()).toBe(1);
    const pg = doc.getPage(0); const tb = pg.getTrimBox(), bb = pg.getBleedBox();
    expect(Math.round(tb.width)).toBe(72); expect(Math.round(bb.width)).toBe(Math.round(72 + 2 * 2.54 / 25.4 * 72));
  });
  it('validation rejects a wrong-sized or wrong-format file', async () => {
    const s = S({ bleedMm: 2.54 }); const wrong = await renderExport(await src(), S());
    await expect(validateOutput(wrong, s)).rejects.toThrow(/validation failed/);
    await expect(validateOutput(wrong, S({ format: 'jpg' }))).rejects.toThrow(/validation failed/);
    await expect(validateOutput(Buffer.from('nope'), S({ format: 'pdf' }))).rejects.toThrow();
  });
  it('rejects an unsupported format value and CMYK is not a selectable format', () => {
    expect(() => S({ format: 'cmyk' })).toThrow(); expect(() => S({ format: 'gif' })).toThrow();
  });
});
