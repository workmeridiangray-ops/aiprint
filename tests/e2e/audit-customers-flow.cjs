// Manual browser check for /vendor/customers and the /admin audit search. Needs the dev seed, tests/e2e/mkplatform.mts users and a server on :3113 started with MFA_REQUIRED_ROLES= (empty).
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const B = process.env.E2E_BASE || 'http://localhost:3113'; const errs = [];
  const login = async (email, re) => { const p = await (await b.newContext({ viewport: { width: 1100, height: 1000 } })).newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(B + '/login'); await p.fill('#email', email); await p.fill('#password', 'dev-password-12345'); await p.click('button'); await p.waitForURL(re); return p; };
  const v = await login('dev.admin@example.test', /\/(vendor|projects)$/); await v.goto(B + '/vendor/customers'); await v.waitForSelector('table');
  console.log('vendor customers rows:', await v.locator('tbody tr').count(), '| first:', (await v.locator('tbody tr').first().innerText()).replace(/\s+/g, ' '));
  await v.fill('#q', 'zzzz-no-such'); await v.click('button:has-text("Search")'); await v.waitForSelector('text=No customers found');
  const c = await login('dev.counter@example.test', /\/(counter|projects|vendor)$/); const r = await c.request.get(B + '/api/vendor/customers'); const body = await r.json();
  console.log('counter sees kinds:', JSON.stringify([...new Set(body.rows.map(x => x.kind))]));
  const o = await login('dev.owner@example.test', /\/admin$/); await o.waitForSelector('text=Audit search');
  await o.fill('#aa', process.argv[3] || 'job.'); await o.click('section:has(h2:text("Audit search")) button:has-text("Search")');
  await o.waitForSelector('section:has(h2:text("Audit search")) table, section:has(h2:text("Audit search")) :text("No matching records")');
  console.log('audit rows:', await o.locator('section:has(h2:text("Audit search")) tbody tr').count());
  await o.screenshot({ path: process.argv[2] || '/tmp/audit.png', fullPage: true });
  console.log('page errors:', JSON.stringify(errs)); await b.close();
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
