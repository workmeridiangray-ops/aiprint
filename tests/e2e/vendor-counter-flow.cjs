const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const B = process.env.E2E_BASE || 'http://localhost:3113'; const errs = [];
  async function login(email) { const ctx = await b.newContext({ viewport: { width: 1000, height: 1100 } }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(B + '/login'); await p.fill('#email', email); await p.fill('#password', 'dev-password-12345'); await p.click('button'); await p.waitForURL('**/projects'); return { ctx, p }; }
  // vendor admin
  let { p } = await login('dev.admin@example.test'); await p.goto(B + '/vendor'); await p.waitForSelector('text=Processing credit available');
  console.log('admin overview text ok:', await p.locator('text=Processing credit available').count());
  await p.fill('#perMp', '12'); await p.fill('#min', '40'); await p.click('text=Save prices'); await p.waitForSelector('text=Current: ₹12.00');
  console.log('pricing line:', await p.locator('text=Current:').innerText());
  await p.fill('#iemail', 'new.staff2@example.test'); await p.click('text=Send invitation'); await p.waitForSelector('text=Invitation queued'); await p.waitForTimeout(500);
  console.log('staff rows:', await p.locator('tbody tr').count());
  await p.screenshot({ path: '/tmp/claude-0/-home-claude/95a4dd48-6c0d-5f4d-a4fb-00a770008b56/scratchpad/vendor.png', fullPage: true });
  // counter staff cannot see vendor overview
  ({ p } = await login('dev.counter@example.test')); await p.goto(B + '/vendor'); await p.waitForSelector('p.err:not(:empty)');
  console.log('counter on /vendor:', await p.locator('p.err').innerText());
  await p.goto(B + '/counter'); await p.fill('#name', 'Walk-in Ravi'); await p.click('text=Continue'); await p.waitForSelector('text=Artwork');
  await p.setInputFiles('#file', '/tmp/claude-0/-home-claude/95a4dd48-6c0d-5f4d-a4fb-00a770008b56/scratchpad/art.png'); await p.click('text=Get price'); await p.waitForSelector('text=Price to collect');
  console.log(await p.locator('text=Price to collect').innerText());
  await p.click('text=Record payment and start processing'); await p.waitForSelector('text=Payment recorded', { timeout: 20000 });
  console.log('receipt:', await p.locator('h2:has-text("Receipt")').innerText());
  await p.screenshot({ path: '/tmp/claude-0/-home-claude/95a4dd48-6c0d-5f4d-a4fb-00a770008b56/scratchpad/counter.png' }); console.log('page errors:', JSON.stringify(errs)); await b.close();
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
