// Manual browser check of the walk-in claim story. Needs the dev seed, a built server on :3113 (MFA_REQUIRED_ROLES= empty) and `npm run worker` running.
// argv[2] = a PNG/JPG to upload, argv[3] = folder for screenshots.
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const B = process.env.E2E_BASE || 'http://localhost:3113'; const errs = [];
  const as = async (email) => { const ctx = await b.newContext({ viewport: { width: 1000, height: 1000 } }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(email + ': ' + e.message));
    await p.goto(B + '/login'); await p.fill('#email', email); await p.fill('#password', 'dev-password-12345'); await p.click('button'); await p.waitForURL(u => !u.pathname.startsWith('/login')); return p; };
  // 1. counter staff serve a walk-in whose recorded contact is the customer's email
  const staff = await as('dev.counter@example.test'); await staff.goto(B + '/counter');
  await staff.fill('#name', 'Walk-in Meena'); await staff.fill('#contact', 'dev.customer@example.test'); await staff.fill('#job', 'Claim demo'); await staff.click('button:has-text("Continue")');
  await staff.setInputFiles('#file', process.argv[2]); await staff.click('button:has-text("Get price")'); await staff.waitForSelector('button:has-text("Record payment")');
  await staff.click('button:has-text("Record payment")'); await staff.waitForSelector('h2:has-text("Receipt")'); const receipt = (await staff.innerText('h2:has-text("Receipt")')).replace('Receipt', '').trim(); console.log('receipt:', receipt);
  await staff.waitForTimeout(8000); // worker
  // 2. a wrong user cannot claim it; the right customer can
  const cust = await as('dev.customer@example.test'); await cust.goto(B + '/account/claim');
  await cust.fill('#receipt', 'R-999999'); await cust.click('button:has-text("Send request")'); await cust.waitForSelector('[role=alert]:not(:empty)'); console.log('unknown receipt message:', (await cust.innerText('[role=alert]')).slice(0, 70));
  await cust.fill('#receipt', receipt); await cust.click('button:has-text("Send request")'); await cust.waitForSelector('[data-status="pending"]'); console.log('customer sees:', await cust.innerText('[data-status="pending"]'));
  const lib0 = await cust.goto(B + '/library'); await cust.waitForSelector('text=Your files'); console.log('library before approval mentions Claim demo:', (await cust.content()).includes('Claim demo'));
  // 3. vendor admin approves
  const adm = await as('dev.admin@example.test'); await adm.goto(B + '/vendor/claims'); await adm.waitForSelector('[data-status="pending"]');
  console.log('admin sees:', (await adm.innerText('[data-status="pending"]')).replace(/\n+/g, ' | ').slice(0, 260));
  await adm.screenshot({ path: process.argv[3] + '/claims-admin.png', fullPage: true });
  await adm.click('button:has-text("Approve")'); await adm.waitForSelector('text=Approved. The customer now owns those files.'); 
  // 4. customer sees the files
  await cust.goto(B + '/library'); await cust.waitForSelector('[data-state]'); console.log('library after approval mentions Claim demo:', (await cust.content()).includes('Claim demo'));
  await cust.goto(B + '/account/claim'); await cust.waitForSelector('[data-status="approved"]'); console.log('customer sees:', await cust.innerText('[data-status="approved"]'));
  await cust.screenshot({ path: process.argv[3] + '/claims-customer.png', fullPage: true });
  const m = await b.newContext({ viewport: { width: 390, height: 800 } }); const mp = await m.newPage(); await mp.goto(B + '/login'); await mp.fill('#email', 'dev.customer@example.test'); await mp.fill('#password', 'dev-password-12345'); await mp.click('button'); await mp.waitForURL('**/projects'); await mp.goto(B + '/account/claim'); await mp.waitForSelector('h1');
  console.log('mobile horizontal overflow:', await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  console.log('page errors:', JSON.stringify(errs)); await b.close();
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
