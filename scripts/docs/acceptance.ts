// Output acceptance record: renders a matrix of synthetic jobs and measures the files independently of validateOutput.
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { renderExport, validateOutput } from '../../src/server/engine';
import { readCmykTiffSamples, readCmykFromPdf, maxTotalInk } from '../../src/server/cmyk';
import { SettingsSchema, outputPixels } from '../../src/server/projects';

const src = await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#2a6f97' } })
  .composite([{ input: Buffer.from('<svg width="1800" height="1200"><rect x="0" y="0" width="900" height="600" fill="#e9c46a"/><circle cx="1300" cy="800" r="300" fill="#e76f51"/></svg>') }])
  .jpeg({ quality: 92 }).toBuffer();

const sizes: Array<[string, number, number]> = [['Business card 90x54', 90, 54], ['A6 105x148', 105, 148], ['A4 210x297', 210, 297], ['A3 297x420', 297, 420], ['Poster 500x500', 500, 500]];
const rows: string[] = []; let pass = 0, fail = 0;
const combos = [...(['png', 'jpg', 'tiff', 'pdf'] as const).map(f => [f, 'rgb'] as const), ['tiff', 'cmyk'] as const, ['pdf', 'cmyk'] as const];
for (const [label, w, h] of sizes) for (const [format, colour] of combos) for (const [dpi, bleed] of [[300, 0], [300, 3], [150, 3]] as const) {
  const s = SettingsSchema.parse({ widthMm: w, heightMm: h, bleedMm: bleed, dpi, fit: 'fill', format, colour });
  const px = outputPixels(s);
  if (px.total > 80_000_000) { rows.push(`| ${label} | ${format} ${colour} | ${dpi} | ${bleed} | refused: ${(px.total/1e6).toFixed(0)} MP over 80 MP limit | | | n/a (expected refusal) |`); continue; }
  try {
    const t0 = Date.now();
    const out = await renderExport(src, s);
    const v = await validateOutput(out, s);
    let measured: string, dens = '', box = '';
    if (format === 'pdf') {
      const d = await PDFDocument.load(out); const p = d.getPage(0); const { width, height } = p.getSize(); const t = p.getTrimBox();
      measured = `${(width / 72 * 25.4).toFixed(1)}x${(height / 72 * 25.4).toFixed(1)} mm page`;
      box = `trim ${(t.width / 72 * 25.4).toFixed(1)}x${(t.height / 72 * 25.4).toFixed(1)} mm`;
      const ok = Math.abs(t.width / 72 * 25.4 - w) < 0.1 && Math.abs(t.height / 72 * 25.4 - h) < 0.1;
      if (!ok) throw new Error('trim box mismatch');
      if (colour === 'cmyk') { const c = readCmykFromPdf(d); if (!c.profileEmbedded || c.width !== px.w || c.height !== px.h) throw new Error('CMYK image check'); box += `, CMYK ICC ${c.width}x${c.height}, max ink ${maxTotalInk(c.data)}%`; }
    } else if (colour === 'cmyk') {
      const m = await sharp(out).metadata(); const c = readCmykTiffSamples(out);
      if (m.space !== 'cmyk' || m.width !== px.w || m.height !== px.h || !m.hasProfile || c.samples !== 4) throw new Error('CMYK TIFF check');
      if (m.density && Math.abs(m.density - dpi) > 0.5) throw new Error(`density ${m.density}`);
      measured = `${m.width}x${m.height} px CMYK, max ink ${maxTotalInk(c.data)}%`; dens = String(m.density ?? '?');
    } else {
      const m = await sharp(out).metadata();
      measured = `${m.width}x${m.height} px`; dens = String(m.density ?? '?');
      if (m.width !== px.w || m.height !== px.h) throw new Error('size mismatch');
      if (m.density && Math.abs(m.density - dpi) > 0.5) throw new Error(`density ${m.density}`);
    }
    pass++; rows.push(`| ${label} | ${format} ${colour} | ${dpi} | ${bleed} | ${measured}${box ? ', ' + box : ''} | ${dens || '-'} | ${v.sha256.slice(0, 12)} | pass (${v.bytes} B, ${Date.now() - t0} ms) |`);
  } catch (e: any) { fail++; rows.push(`| ${label} | ${format} ${colour} | ${dpi} | ${bleed} | | | | FAIL ${e.message} |`); }
}
writeFileSync('docs/OUTPUT_ACCEPTANCE.md', `# Output acceptance record

Generated ${new Date().toISOString()} by \`npx tsx scripts/docs/acceptance.ts\`.

**Scope and limits (read first)**
- Source image is a **synthetic** 1800x1200 test picture generated in the script. It is not client artwork and nothing here is client-approved.
- Each row renders through the real export engine, then re-measures the file with sharp / pdf-lib separately from the engine's own validator.
- Colour: RGB rows are sRGB. CMYK rows (TIFF and PDF) use the bundled FOGRA39 profile with a 300% total-ink limit; they are checked for size, colour model, embedded profile and maximum ink only. The client has not confirmed the profile or supplied sample artwork, so **colour accuracy against a real press is not tested**.
- Not tested here: print-shop colour accuracy, printed trim accuracy, PDF/X compliance (the PDF sets Bleed and Trim boxes only and does not claim PDF/X; the quotation excludes it), preview-versus-export pixel parity.
- Bleed is mirrored real pixels, no generated content.
- Sizes over 80 megapixels including bleed are refused by design; those rows show the expected refusal.

Result: ${pass} passed, ${fail} failed.

| Size | Format | DPI | Bleed mm | Measured | Density | SHA-256 (12) | Result |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`);
console.log({ pass, fail }); process.exit(fail ? 1 : 0);
