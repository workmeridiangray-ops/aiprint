// Manual browser check: needs seeded dev DB, running server on :3113, and at least one finished job for dev.customer.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1000, height: 900 } }); const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  const B = process.env.E2E_BASE || 'http://localhost:3113';
  await p.goto(B + '/login'); await p.fill('#email', 'dev.customer@example.test'); await p.fill('#password', 'dev-password-12345'); await p.click('button'); await p.waitForURL('**/projects');
  await p.goto(B + '/library'); await p.waitForSelector('[data-state]');
  console.log('files listed:', await p.locator('[data-state]').count(), 'first state:', await p.getAttribute('[data-state] >> nth=0', 'data-state'));
  console.log('download link present:', await p.locator('a:has-text("Download")').count() > 0);
  console.log('charges table rows:', await p.locator('tbody tr').count());
  await p.screenshot({ path: process.argv[2] || 'library.png' });
  // expiry display: make the newest file expire in 3 days directly in the dev DB, reload
  console.log('page errors:', JSON.stringify(errs)); await b.close();
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
