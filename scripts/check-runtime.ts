// Run in the Docker build and available as `npm run check-runtime`: confirms the pieces CMYK export, enhancement and previews need.
import fs from 'node:fs';
import { enhanceAvailable, enhanceImage } from '../src/server/enhance';
import { watermarkVisible } from '../src/server/preview';
import { toCmykRaster, CMYK_PROFILE_PATH } from '../src/server/cmyk';
import sharp from 'sharp';
(async () => {
  const fails: string[] = [];
  if (!fs.existsSync(CMYK_PROFILE_PATH)) fails.push('CMYK profile file missing');
  else { const r = await toCmykRaster(await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } }).png().toBuffer()); if (r.data[0] + r.data[1] + r.data[2] + r.data[3] !== 0) fails.push('CMYK conversion of white is not zero ink'); }
  if (!(await enhanceAvailable(true))) fails.push('enhancement library or models missing');
  else { const m = await sharp(await enhanceImage(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).png().toBuffer(), 2)).metadata(); if (m.width !== 16) fails.push('enhancement output size wrong'); }
  if (!(await watermarkVisible())) fails.push('watermark text not drawn (font missing?)');
  if (fails.length) { console.error('runtime check FAILED:\n- ' + fails.join('\n- ')); process.exit(1); }
  console.log('runtime check ok: CMYK profile, enhancement, watermark');
})();
