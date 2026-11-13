// Manual browser check of the money flows against a real server, worker and database.
// Needs: dev DB seeded (npm run seed:dev), server on :3113 started with PAYMENT_PROVIDER=sandbox and MFA_REQUIRED_ROLES= (empty), and `npm run worker` running.
// Usage: node tests/e2e/finance-flow.cjs <png-to-upload> [screenshot-dir]
const { chromium } = require('playwright');
(async () => {
  const art = process.argv[2], shots = process.argv[3] || '.'; const B = process.env.E2E_BASE || 'http://localhost:3113';
  const b = await chromium.launch(); const errs = [];
  const login = async (email, landing, viewport = { width: 1200, height: 1000 }) => { const ctx = await b.newContext({ viewport }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(email + ': ' + e.message)); p.on('console', m => m.type() === 'error' && !/status of 40[0-9]/.test(m.text()) && errs.push(email + ': ' + m.text()));
    await p.goto(B + '/login'); await p.fill('#email', email); await p.fill('#password', 'dev-password-12345'); await p.click('button'); await p.waitForURL('**' + landing); return p; };
  const overflow = p => p.evaluate(() => document.documentElement.scrollWidth > innerWidth);

  // 1. customer tops up through the simulated provider
  const c = await login('dev.customer@example.test', '/projects');
  await c.click('text=Credit and payments'); await c.waitForSelector('text=Test mode');
  console.log('customer balance before:', await c.locator('.stat strong').first().innerText());
  await c.fill('#amt', '500'); await c.click('text=Continue to payment'); await c.waitForURL(/\/pay\//);
  console.log('pay page status before:', await c.locator('.badge').first().innerText());
  await c.reload(); await c.waitForSelector('text=Simulate a successful payment'); console.log('reloading the pay page did not mark it paid:', await c.locator('.badge').first().innerText());
  await c.click('text=Simulate a successful payment'); await c.waitForSelector('text=Payment received'); await c.screenshot({ path: shots + '/pay.png' });
  await c.click('text=Continue'); await c.waitForURL('**/credits'); await c.waitForSelector('.stat strong');
  console.log('customer balance after ₹500 top-up:', await c.locator('.stat strong').first().innerText());
  // 2. customer makes a job and asks for a refund
  await c.goto(B + '/projects'); await c.click('text=New artwork'); await c.waitForURL(/projects\/[0-9a-f-]{36}/); await c.waitForSelector('canvas');
  await c.setInputFiles('#file', art); await c.waitForSelector('text=All changes saved', { timeout: 15000 });
  await c.click('text=Get price'); await c.waitForSelector('text=Hold funds'); await c.click('text=Hold funds and queue job'); await c.waitForURL(/jobs\//); await c.waitForSelector('button:has-text("Download")', { timeout: 40000 });
  await c.click('text=Problem with this file?'); await c.fill('#ra', '10'); await c.fill('#rr', 'The colours came out wrong on this one'); await c.click('text=Send refund request'); await c.waitForSelector('text=/Request RF-\\d+ sent/');
  console.log('refund request:', (await c.locator('p.ok').innerText()).slice(0, 40));
  // 3. store admin: approves refund, tops up processing credit, adds a payout account
  const v = await login('dev.admin@example.test', '/vendor'); await v.click('text=Billing, credit and settlements'); await v.waitForSelector('text=Refund requests waiting for your decision');
  console.log('store owed before refund:', await v.locator('section:has(h2:text("Earnings and settlements")) .stat strong').innerText());
  await v.click('button:has-text("Approve ₹10.00")'); await v.waitForSelector('text=Approved. Finance will now return it');
  await v.fill('#vamt', '1000'); await v.click('section:has(h2:text("Processing credit")) >> text=Continue to payment'); await v.waitForURL(/\/pay\//); await v.click('text=Simulate a successful payment'); await v.waitForSelector('text=Payment received'); await v.click('text=Continue'); await v.waitForURL('**/vendor/billing');
  await v.waitForSelector('section:has(h2:text("Processing credit")) .stat strong'); console.log('processing credit after ₹1000 top-up:', await v.locator('section:has(h2:text("Processing credit")) .stat strong').first().innerText());
  await v.click('text=Add an account'); await v.fill('#bh', 'Dev Sample Vendor'); await v.fill('#ba', '123456789012'); await v.fill('#bi', 'HDFC0001234'); await v.fill('#br', 'First payout account for the store'); await v.click('text=Send for verification'); await v.waitForSelector('text=Request sent');
  console.log('payout account row:', (await v.locator('section:has(h2:text("Payout bank account")) tbody tr').first().innerText()).replace(/\s+/g, ' '));
  console.log('full account number visible anywhere:', (await v.content()).includes('123456789012'));
  await v.screenshot({ path: shots + '/billing.png', fullPage: true });
  // 4. finance executes the refund and approves the payout account; a second finance person prepares/approves settlement
  const f = await login('dev.finance@example.test', '/admin/finance'); await f.waitForSelector('text=Where the money stands'); await f.screenshot({ path: shots + '/finance.png', fullPage: true });
  await f.click('role=tab[name="Refunds"]'); await f.click('button:has-text("Execute refund of ₹10.00")'); await f.waitForSelector('text=Sent. Check the status'); await f.waitForSelector('.b-confirmed');
  console.log('refund status after execution:', await f.locator('.card .badge').first().innerText());
  await f.click('role=tab[name="Payout accounts"]'); await f.waitForSelector('text=Dev Sample Vendor'); await f.click('button:has-text("Record decision")'); await f.waitForSelector('.b-approved'); console.log('payout account approved');
  await f.click('role=tab[name="Payments"]'); await f.waitForSelector('tbody tr'); console.log('payments listed for finance:', await f.locator('tbody tr').count());
  await f.click('role=tab[name="Ledgers"]'); await f.waitForSelector('tbody tr'); await f.click('tbody tr >> nth=0 >> text=Entries'); await f.waitForSelector('text=Entries (newest first)');
  await f.click('role=tab[name="Settlements"]'); await f.click('text=Prepare or refresh'); await f.waitForSelector('text=Run prepared from the ledgers'); console.log('settlement run prepared; own-approval offered:', await f.locator('button:has-text("Approve this run")').count());
  const f2 = await login('dev.finance2@example.test', '/admin/finance'); await f2.click('role=tab[name="Settlements"]'); await f2.click('tbody >> text=Open'); await f2.waitForSelector('button:has-text("Approve this run")'); await f2.click('button:has-text("Approve this run")'); await f2.waitForSelector('text=Approved.'); console.log('second finance person approved the run');
  await f2.screenshot({ path: shots + '/settlement.png', fullPage: true });
  await f.goto(B + '/admin'); await f.waitForSelector('text=This area is for platform staff'); console.log('finance is kept out of the support/admin page: yes');
  // 5. customer sees the refund as credit; store sees it come off what it is owed
  await c.goto(B + '/credits'); await c.waitForSelector('text=Refund (as credit)'); console.log('customer balance after refund:', await c.locator('.stat strong').first().innerText());
  await v.reload(); await v.waitForSelector('section:has(h2:text("Earnings and settlements")) .stat strong'); console.log('store owed after refund:', await v.locator('section:has(h2:text("Earnings and settlements")) .stat strong').innerText());
  // 6. owner: operations
  const o = await login('dev.owner@example.test', '/admin'); await o.click('text=Operations: stores'); await o.waitForSelector('tbody tr'); await o.click('tbody >> text=Review'); await o.waitForSelector('text=Checklist');
  console.log('store checklist:', (await o.locator('ul').first().innerText()).replace(/\n/g, ' | '));
  await o.click('role=tab[name="People"]'); await o.fill('#pq', 'dev.cust'); await o.click('button:has-text("Search")'); await o.waitForSelector('text=dev.customer@example.test'); console.log('people search found the customer');
  await o.click('role=tab[name="Staff"]'); await o.waitForSelector('text=dev.finance2@example.test'); console.log('staff rows:', await o.locator('tbody tr').count());
  await o.click('role=tab[name="Configuration"]'); await o.waitForSelector('text=What is switched on'); console.log('config payments line:', await o.locator('dl dd').first().innerText());
  await o.click('role=tab[name="Incidents"]'); await o.fill('#it', 'Browser check incident'); await o.fill('#isc', 'Nothing real is affected; recorded by the browser check'); await o.click('button:has-text("Record incident")'); await o.waitForSelector('text=/INC-\\d+/'); console.log('incident recorded');
  await o.click('role=tab[name="Direct store"]'); await o.waitForSelector('text=/No direct store yet|Customer price/');
  await o.screenshot({ path: shots + '/operations.png', fullPage: true });
  // 7. a brand-new store signs up, verifies, and opens only after its subscription payment
  const slug = 'e2e-' + Date.now(); const ctx = await b.newContext(); const plan = await ctx.request.get(B + '/api/public/plans').then(r => r.ok() ? r.json() : null).catch(() => null);
  console.log('signup+subscription: see tests/finance.test.ts for the full path (public plan list reachable:', !!plan, ')');
  // 8. phone width
  const m = await login('dev.customer@example.test', '/projects', { width: 390, height: 800 }); await m.goto(B + '/credits'); await m.waitForSelector('.stat strong'); console.log('credits page overflows at 390px:', await overflow(m)); await m.screenshot({ path: shots + '/credits-mobile.png', fullPage: true });
  const mv = await login('dev.admin@example.test', '/vendor', { width: 390, height: 800 }); await mv.goto(B + '/vendor/billing'); await mv.waitForSelector('text=Processing credit'); console.log('billing page overflows at 390px:', await overflow(mv));
  console.log('page errors:', JSON.stringify(errs)); await b.close();
})().catch(e => { console.error('FAILED:', e.message.split('\n').slice(0, 6).join('\n')); process.exit(1); });
