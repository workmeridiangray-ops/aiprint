import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { workOnce, jobStatus, readPreview, readOutput } from '../src/server/worker';
import { runRetention } from '../src/server/retention';
import { makeWatermarkedPreview, watermarkVisible, PREVIEW_MAX_PX } from '../src/server/preview';
import { getPool } from '../src/server/db';

let T: string;
beforeAll(async () => { await setupDb(); T = await mkTenant('PV'); });
afterAll(closePool);
const S = { widthMm: 148, heightMm: 210, bleedMm: 3, dpi: 300, fit: 'fill' as const };
const photo = () => sharp({ create: { width: 800, height: 1100, channels: 3, background: '#3a7' } }).png().toBuffer();
async function done(email: string, settings: object = S) {
  const u = await mkActor(T, email); const p = await createProject(u, 'P');
  const f = await saveOriginal(u, await photo()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings });
  await fund(T, u.userId, 100000, `c-${email}`); await fund(T, null, 1_000_000, `v-${email}`);
  const q = await createQuote(u, p.id); const r = await reserveQuote(u, q.quoteId); await workOnce('w-pv');
  const st = await jobStatus(u, r.jobId); return { u, outputId: st.outputId! };
}

describe('watermark', () => {
  it('draws visible text on this server (fails if the font is missing)', async () => { expect(await watermarkVisible()).toBe(true); });
  it('is reduced in size, JPEG, and differs from a plain resize of the same image', async () => {
    const rgb = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#808080' } }).png().toBuffer();
    const p = await makeWatermarkedPreview(rgb);
    const m = await sharp(p.jpeg).metadata();
    expect(m.format).toBe('jpeg'); expect(Math.max(m.width!, m.height!)).toBe(PREVIEW_MAX_PX); expect([m.width, m.height]).toEqual([p.width, p.height]);
    const plain = await sharp(rgb).resize(m.width, m.height).raw().toBuffer(); const wm = await sharp(p.jpeg).raw().toBuffer();
    let diff = 0; for (let i = 0; i < wm.length; i++) if (Math.abs(wm[i] - plain[i]) > 20) diff++;
    expect(diff / wm.length).toBeGreaterThan(0.01);
  });
});

describe('result preview', () => {
  it('a finished job has a watermarked preview that is smaller than the clean file; the clean file is untouched', async () => {
    const x = await done('pv1@x.test');
    const prev = await readPreview(x.u, x.outputId);
    const pm = await sharp(prev).metadata();
    const clean = await readOutput(x.u, x.outputId); const cm = await sharp(clean.buf).metadata();
    expect(pm.format).toBe('jpeg'); expect(pm.width!).toBeLessThanOrEqual(PREVIEW_MAX_PX); expect(cm.width!).toBeGreaterThan(pm.width!);
    // the clean export has no watermark: a flat green source stays flat green
    const px = await sharp(clean.buf).extract({ left: 100, top: 100, width: 50, height: 50 }).raw().toBuffer();
    expect(new Set([...px]).size).toBeLessThanOrEqual(3);
  });
  it('CMYK TIFF and PDF outputs also get previews', async () => {
    for (const [i, fmt] of (['tiff', 'pdf'] as const).entries()) {
      const x = await done(`pv2${i}@x.test`, { ...S, widthMm: 50, heightMm: 50, format: fmt, colour: 'cmyk' });
      expect((await sharp(await readPreview(x.u, x.outputId)).metadata()).format).toBe('jpeg');
    }
  });
  it('other users and tenants cannot see it', async () => {
    const x = await done('pv3@x.test');
    const other = await mkActor(T, 'pv3b@x.test'); const foreign = await mkActor(await mkTenant('PV2'), 'pv3c@x.test');
    for (const a of [other, foreign]) await expect(readPreview(a, x.outputId)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('is removed when the file is purged, and the file is refused afterwards', async () => {
    const x = await done('pv4@x.test');
    await getPool().query("update outputs set expires_at=now() - interval '1 day' where id=$1", [x.outputId]);
    await runRetention(new Date());
    expect((await getPool().query('select 1 from output_previews where output_id=$1', [x.outputId])).rowCount).toBe(0);
    await expect(readPreview(x.u, x.outputId)).rejects.toMatchObject({ code: 'removed' });
  });
});
