// Manual browser check: CMYK TIFF + 2x enhancement with before/after preview, paid job, watermarked preview, library label.
// Needs the dev seed, a built server on :3113 (MFA_REQUIRED_ROLES= empty) and `npm run worker` running.
const { chromium } = require('playwright'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 1300 } }); const p = await ctx.newPage();
  const B = 'http://localhost:3113'; const errs = []; const bad = []; p.on('response', r => r.status() >= 400 && bad.push(r.status() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, ''))); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(B + '/login'); await p.fill('#email', 'dev.customer@example.test'); await p.fill('#password', 'dev-password-12345'); await p.click('button'); await p.waitForURL('**/projects');
  await p.click('text=New artwork'); await p.waitForURL(/projects\/[0-9a-f-]{36}/); await p.waitForSelector('canvas');
  await p.setInputFiles('#file', process.argv[2]); await p.waitForSelector('text=All changes saved', { timeout: 15000 });
  await p.selectOption('#format', 'png'); console.log('colour disabled for PNG:', await p.isDisabled('#colour'));
  await p.selectOption('#format', 'tiff'); console.log('colour enabled for TIFF:', !(await p.isDisabled('#colour')));
  await p.selectOption('#colour', 'cmyk'); await p.selectOption('#format', 'png'); console.log('back to PNG forces RGB:', await p.inputValue('#colour'));
  await p.selectOption('#format', 'tiff'); await p.selectOption('#colour', 'cmyk'); await p.selectOption('#enhance', '2x');
  await p.click('text=Preview before and after'); await p.waitForSelector('img[alt^="After"]', { timeout: 30000 });
  const dims = await p.evaluate(() => [...document.querySelectorAll('figure img')].map(i => [i.naturalWidth, i.naturalHeight]));
  console.log('before/after natural sizes:', JSON.stringify(dims));
  await p.waitForSelector('text=All changes saved', { timeout: 15000 });
  await p.screenshot({ path: process.argv[3] + '/cmyk-editor.png', fullPage: true });
  await p.click('text=Get price'); await p.waitForSelector('text=Hold funds'); await p.click('text=Hold funds and queue job'); await p.waitForURL(/jobs\//);
  await p.waitForSelector('img[alt^="Watermarked preview"]', { timeout: 60000 });
  await p.waitForFunction(() => { const i = document.querySelector('img[alt^="Watermarked preview"]'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 15000 });
  console.log('job page preview loaded, width:', await p.evaluate(() => document.querySelector('img[alt^="Watermarked preview"]').naturalWidth));
  await p.screenshot({ path: process.argv[3] + '/cmyk-job.png', fullPage: true });
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('button:has-text("Download")')]);
  const body = fs.readFileSync(await dl.path()); console.log('download', dl.suggestedFilename(), 'TIFF header:', body.slice(0, 4).toString('hex'), body.length, 'bytes');
  await p.goto(B + '/library'); await p.waitForSelector('[data-state]');
  console.log('library first row has CMYK label:', (await p.locator('.card >> nth=0').innerText()).includes('CMYK'));
  await p.screenshot({ path: process.argv[3] + '/cmyk-library.png', fullPage: false });
  const m = await ctx.newPage(); await m.setViewportSize({ width: 390, height: 800 }); await m.goto(B + '/library'); await m.waitForSelector('[data-state]');
  console.log('mobile library horizontal overflow:', await m.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  console.log('failed requests:', JSON.stringify(bad)); console.log('page errors:', JSON.stringify(errs)); await b.close();
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
