// Manual browser check. Needs seeded dev DB (customer/admin/counter), platform users (mkplatform.mts), a finished job for dev.customer,
// and a server on :3113 started with MFA_REQUIRED_ROLES= (empty). Creates a throwaway customer for the closure part.
const { chromium } = require('playwright'); const { Client } = require('pg');
(async () => {
  const B = process.env.E2E_BASE || 'http://localhost:3113'; const b = await chromium.launch(); const errs = []; const PW = 'dev-password-12345';
  const page = async (email) => { const ctx = await b.newContext({ viewport: { width: 1000, height: 1000 } }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(B + '/login'); await p.fill('#email', email); await p.fill('#password', PW); await p.click('button:has-text("Sign in")'); await p.waitForURL(/\/(admin|projects)$/); return p; };
  // customer opens a ticket from a file in the library
  const c = await page('dev.customer@example.test'); await c.goto(B + '/library'); await c.waitForSelector('a:has-text("Get help with this file")'); await c.click('a:has-text("Get help with this file") >> nth=0');
  await c.waitForSelector('text=This ticket will be linked'); await c.fill('#sub', 'Colours look different ' + Date.now()); await c.fill('#bod', 'The export looks darker than my screen'); await c.click('button:has-text("Send")'); await c.waitForURL('**/support/*');
  const url = c.url(); const ref = (await c.innerText('p.muted')).split(' · ')[0]; console.log('ticket created:', ref, '| linked:', (await c.innerText('p.muted')).includes('linked output'));
  // store admin: internal note, assign, request info, escalate
  const a = await page('dev.admin@example.test'); await a.goto(url); await a.waitForSelector('text=Handling');
  await a.check('text=Staff note'); await a.fill('#msg', 'INTERNAL: customer monitor is probably uncalibrated'); await a.click('button:has-text("Add note")'); await a.waitForSelector('[data-kind=internal]');
  await a.check('text=Reply to customer'); await a.fill('#msg', 'Could you tell us which screen you compare against?'); await a.click('button:has-text("Send reply")'); await a.waitForSelector('text=Waiting for the customer');
  await c.reload(); await c.waitForSelector('text=Could you tell us'); console.log('customer sees staff reply:', true, '| sees internal note:', await c.locator('text=INTERNAL').count() > 0);
  await c.fill('#msg', 'A laptop screen'); await c.click('button:has-text("Send reply")'); await c.waitForSelector('text=A laptop screen');
  await a.reload(); await a.fill('#why', 'Needs platform to check colour handling'); await a.click('button:has-text("Escalate")'); await a.waitForSelector('text=With platform support');
  // platform owner resolves with evidence
  const o = await page('dev.owner@example.test'); await o.goto(url); await o.waitForSelector('text=Handling');
  await o.fill('#res', 'Explained sRGB-only output'); await o.fill('#ev', 'Checked output profile: sRGB, no CMYK conversion'); await o.click('button:has-text("Mark resolved")'); await o.waitForSelector('.card:has-text("Resolved.")');
  await c.reload(); await c.waitForSelector('.card:has-text("Resolved.")'); console.log('customer sees resolution + evidence:', (await c.innerText('.card:has-text("Resolved.")')).includes('Evidence'), '| internal note hidden:', await c.locator('text=INTERNAL').count() === 0, '| escalation reason hidden:', await c.locator('text=colour handling').count() === 0);
  await c.screenshot({ path: process.argv[2] || 'support.png', fullPage: true }); await c.click('text=This fixed it: close'); await c.waitForSelector('text=Closed');
  // closure with a throwaway customer
  const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect(); const email = `closer${Date.now()}@example.test`;
  const tenant = (await db.query("select tenant_id from memberships m join users u on u.id=m.user_id where u.email='dev.customer@example.test' limit 1")).rows[0].tenant_id;
  require('child_process').execSync(`npx tsx tests/e2e/mkcustomer.mts ${email} ${PW} ${tenant}`, { env: process.env, stdio: 'pipe' });
  const x = await page(email); await x.goto(B + '/account/data'); await x.waitForSelector('text=Close my account');
  await x.click('button:has-text("Prepare my data")'); await x.waitForSelector('a:has-text("Download (JSON)")'); console.log('export ready: true');
  await x.click('button:has-text("Start closing my account")'); await x.waitForSelector('text=Last step'); await x.fill('#pw', 'wrong-password-123'); await x.click('button:has-text("Close my account for good")'); await x.waitForSelector('.err:has-text("incorrect")'); console.log('wrong password refused: true');
  await x.fill('#pw', PW); await x.click('button:has-text("Close my account for good")'); await x.waitForURL('**/login'); console.log('closed, sent to sign-in: true');
  await x.fill('#email', email); await x.fill('#password', PW); await x.click('button:has-text("Sign in")'); await x.waitForSelector('.err:not(:empty)'); console.log('can sign in again:', false);
  // customer with leftover credit is blocked and told why
  const k = await page('dev.customer@example.test'); await k.goto(B + '/account/data'); await k.click('button:has-text("Start closing my account")'); await k.waitForSelector('[data-testid=liabilities]'); console.log('blocked reasons shown:', (await k.locator('[data-testid=liabilities] li').allInnerTexts()).map(s => s.slice(0, 50)));
  await db.end(); console.log('page errors:', JSON.stringify(errs)); await b.close();
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
