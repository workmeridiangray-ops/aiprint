// Manual browser check: drag to move and corner-handle resize (needs dev server on 3113 and the dev seed).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1100, height: 1200 } })).newPage();
  const B = process.env.E2E_BASE || 'http://localhost:3113'; const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(B + '/projects'); await p.waitForURL('**/login');
  await p.fill('#email', 'dev.customer@example.test'); await p.fill('#password', 'dev-password-12345'); await p.click('button'); await p.waitForURL('**/projects');
  await p.click('text=New artwork'); await p.waitForURL(/projects\/[0-9a-f-]{36}/); await p.waitForSelector('canvas');
  await p.setInputFiles('#file', process.argv[2]); await p.waitForSelector('text=All changes saved', { timeout: 15000 });
  await p.fill('#scale', '0.6'); await p.waitForSelector('text=All changes saved', { timeout: 15000 }); await p.waitForTimeout(300);
  const box = await p.locator('canvas').boundingBox();
  const x0 = box.x + box.width * 0.5, y0 = box.y + box.height * 0.5;
  await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move(x0 + 60, y0 + 30, { steps: 6 }); await p.mouse.up();
  await p.waitForSelector('text=All changes saved', { timeout: 15000 });
  console.log('after drag offsets', await p.inputValue('#offsetXMm'), await p.inputValue('#offsetYMm'));
  const s0 = await p.inputValue('#scale');
  // find handle by scanning for the teal square colour (#0f5f63) near image corner
  const hpos = await p.evaluate(() => { const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height); let sx = 0, sy = 0, n = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (d.data[i] === 15 && d.data[i + 1] === 95 && d.data[i + 2] === 99) { sx += x; sy += y; n++; } }
    const r = c.getBoundingClientRect(); return n ? { x: r.left + (sx / n) * (r.width / c.width), y: r.top + (sy / n) * (r.height / c.height), n } : null; });
  console.log('handle found', JSON.stringify(hpos));
  await p.mouse.move(hpos.x, hpos.y); await p.mouse.down(); await p.mouse.move(hpos.x + 40, hpos.y + 40, { steps: 6 }); await p.mouse.up();
  await p.waitForSelector('text=All changes saved', { timeout: 15000 });
  console.log('scale before/after resize', s0, await p.inputValue('#scale'));
  await p.click('text=Undo'); await p.waitForTimeout(200); console.log('after undo scale', await p.inputValue('#scale'));
  await p.reload(); await p.waitForSelector('canvas'); await p.waitForTimeout(800); console.log('after reload offsets', await p.inputValue('#offsetXMm'), await p.inputValue('#offsetYMm'));
  console.log('page errors', JSON.stringify(errs)); await b.close();
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
