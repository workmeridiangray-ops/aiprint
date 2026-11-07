// Manual browser check. Needs dev DB with platform users (tests/e2e/mkplatform.mts) and a server on :3113.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const errs = []; const B = 'http://localhost:3113';
  const login = async (email) => { const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 } }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await p.goto(B + '/login'); await p.fill('#email', email); await p.fill('#password', 'dev-password-12345'); await p.click('button'); await p.waitForURL(/\/(admin|projects)$/); return p; };
  const o = await login('dev.owner@example.test'); console.log('owner lands on:', new URL(o.url()).pathname);
  await o.waitForSelector('text=Processing price'); 
  await o.fill('#pm', '1.50'); await o.fill('#mn', '3'); await o.click('text=Save price'); await o.waitForSelector('text=Processing price saved.');
  console.log('price line:', (await o.locator('section:has(h2:text("Processing price")) p.muted').first().innerText()).slice(0, 80));
  await o.fill('#pc', 'e2e-' + Date.now()); await o.fill('#pn', 'E2E plan'); await o.fill('#ps', '3'); await o.fill('#pp', '999'); await o.click('text=Save plan'); await o.waitForSelector('text=Plan saved');
  await o.screenshot({ path: process.argv[2] || 'admin.png', fullPage: true });
  const s = await login('dev.support@example.test'); await s.waitForSelector('text=Processing price');
  console.log('support sees owner-only note:', await s.locator('text=Only the platform owner can change this.').count() === 1, '| price form hidden:', await s.locator('#pm').count() === 0);
  const c = await login('dev.customer@example.test'); console.log('customer lands on:', new URL(c.url()).pathname);
  await c.goto(B + '/admin'); await c.waitForSelector('text=This area is for platform staff.'); console.log('customer blocked from admin data: true');
  console.log('page errors:', JSON.stringify(errs.filter(e => !/40[13]/.test(e)))); await b.close();
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
