import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject, validateSettings } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { workOnce, jobStatus, readOutput } from '../src/server/worker';
import { renderExport } from '../src/server/engine';
import { enhanceAvailable, enhanceImage, enhancePreview, assertEnhanceUsable, ENHANCE_MAX_PIXELS } from '../src/server/enhance';
import { balance } from '../src/server/ledger';

let T: string, available = false;
beforeAll(async () => { await setupDb(); T = await mkTenant('E'); available = await enhanceAvailable(true); });
afterAll(closePool);
const detail = (w = 120, h = 90) => { const raw = Buffer.alloc(w * h * 3); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 3, v = ((x >> 3) + (y >> 3)) % 2 ? 230 : 25; raw[o] = v; raw[o + 1] = (x * 2) % 256; raw[o + 2] = 255 - v; } return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer(); };
const base = { widthMm: 50.8, heightMm: 38.1, bleedMm: 0, dpi: 300, fit: 'fill' as const };

describe('enhancement settings', () => {
  it('defaults to off and accepts only off, 2x, 4x', () => {
    expect(validateSettings(base).enhance).toBe('off');
    expect(validateSettings({ ...base, enhance: '4x' }).enhance).toBe('4x');
    expect(() => validateSettings({ ...base, enhance: '8x' })).toThrow();
  });
  it('a too-large enlargement is refused before any price is given', async () => {
    await expect(assertEnhanceUsable('4x', 4000, 3000)).rejects.toMatchObject({ code: 'enhance_too_large' });
    await expect(assertEnhanceUsable('off', 99999, 99999)).resolves.toBeUndefined();
    expect(ENHANCE_MAX_PIXELS).toBe(40_000_000);
  });
});

describe('enhancement with the real library', () => {
  it('is installed (set up per docs/DEPLOY.md); every test below needs it', () => { expect(available, 'python3 + opencv-contrib dnn_superres + ESPCN models must be installed').toBe(true); });
  it('enlarges exactly 2x and 4x and keeps alpha', async () => {
    const png = await detail(); const a = await sharp(png).ensureAlpha().png().toBuffer();
    for (const f of [2, 4] as const) { const m = await sharp(await enhanceImage(a, f)).metadata(); expect([m.width, m.height, m.channels]).toEqual([120 * f, 90 * f, 4]); }
  });
  it('the export with enhancement differs from plain resizing and has the requested size', async () => {
    const png = await detail(60, 45);
    const plain = await renderExport(png, validateSettings({ ...base, format: 'png' }));
    const enh = await renderExport(png, validateSettings({ ...base, format: 'png', enhance: '4x' }));
    const mp = await sharp(plain).metadata(), me = await sharp(enh).metadata();
    expect([me.width, me.height]).toEqual([mp.width, mp.height]);
    expect(Buffer.compare(plain, enh)).not.toBe(0);
  });
  it('preview returns before and after images of the same size', async () => {
    const u = await mkActor(T, 'e0@x.test'); const p = await createProject(u, 'P');
    const f = await saveOriginal(u, await detail(200, 150)); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: base });
    const r = await enhancePreview(u, p.id, 2);
    const dim = async (d: string) => { const m = await sharp(Buffer.from(d.split(',')[1], 'base64')).metadata(); return [m.width, m.height]; };
    expect(await dim(r.before)).toEqual([192, 192]); expect(await dim(r.after)).toEqual([192, 192]);
    const other = await mkActor(T, 'e0b@x.test'); await expect(enhancePreview(other, p.id, 2)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('a paid job with 2x enhancement runs through quote, queue and worker and consumes credit once', async () => {
    const u = await mkActor(T, 'e1@x.test'); const p = await createProject(u, 'P');
    const f = await saveOriginal(u, await detail(200, 150)); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: { ...base, format: 'tiff', colour: 'cmyk', enhance: '2x' } });
    const ca = await fund(T, u.userId, 100000, 'c-e1'); await fund(T, null, 1_000_000, 'v-e1');
    const q = await createQuote(u, p.id); const r = await reserveQuote(u, q.quoteId);
    expect(await workOnce('w-e')).toBe(true);
    const st = await jobStatus(u, r.jobId); expect(st.status).toBe('succeeded');
    const m = await sharp((await readOutput(u, st.outputId!)).buf).metadata(); expect(m.space).toBe('cmyk');
    expect((await balance(ca)).settled).toBe(100000 - q.customerAmountPaise);
  });
});

describe('enhancement unavailable', () => {
  it('quote is refused with a clear message and nothing is held', async () => {
    const old = process.env.ENHANCE_PYTHON; process.env.ENHANCE_PYTHON = '/nonexistent/python'; await enhanceAvailable(true);
    try {
      const u = await mkActor(T, 'e2@x.test'); const p = await createProject(u, 'P');
      const f = await saveOriginal(u, await detail(200, 150)); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: { ...base, enhance: '2x' } });
      const ca = await fund(T, u.userId, 100000, 'c-e2'); await fund(T, null, 1_000_000, 'v-e2');
      await expect(createQuote(u, p.id)).rejects.toMatchObject({ code: 'enhance_unavailable' });
      expect((await balance(ca)).held).toBe(0);
    } finally { if (old === undefined) delete process.env.ENHANCE_PYTHON; else process.env.ENHANCE_PYTHON = old; await enhanceAvailable(true); }
  });
});
