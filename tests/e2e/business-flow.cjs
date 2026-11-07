const { chromium } = require('playwright'); const { execSync } = require('child_process');
const B = 'http://localhost:3118'; const DB = process.env.DATABASE_URL;
const sql = q => execSync('psql "' + DB + '" -tAc "' + q.replace(/"/g, '\\"') + '"').toString().trim();
(async () => {
  const b = await chromium.launch(); const errs = [];
  async function login(email) { const ctx = await b.newContext({ viewport: { width: 1100, height: 1200 } }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message));
    await p.goto(B + '/login'); await p.fill('#email', email); await p.fill('#password', email.startsWith('new') ? 'a-long-password-123' : 'dev-password-12345'); await p.click('button'); await p.waitForURL('**/projects'); return { ctx, p }; }
  const admin = (await login('dev.customer@example.test')).p; const member = (await login('new.customer@example.test')).p;
  await admin.goto(B + '/business'); await admin.fill('#name', 'Acme Print Buyers'); await admin.click('button:has-text("Create organisation")'); await admin.waitForSelector('text=Shared credit available');
  const orgId = sql("select id from organisations where name='Acme Print Buyers' and status='active'"); console.log('org created, seats text:', await admin.locator('text=of 10').first().innerText());
  await admin.fill('#iemail', 'new.customer@example.test'); await admin.click('button:has-text("Send invitation")'); await admin.waitForSelector('text=Invitation queued');
  const tok = JSON.parse(sql("select body from email_outbox where template='org_invite' order by id desc limit 1")).token;
  await member.goto(B + '/business/join?token=' + tok); await member.waitForSelector('text=You have joined');
  // fund shared credit (stands in for a verified top-up, which is provider-blocked)
  const t = sql("select tenant_id from organisations where id='" + orgId + "'");
  sql("insert into ledger_accounts(tenant_id,kind,org_id) values('" + t + "','organisation_service_credit','" + orgId + "')");
  sql("insert into ledger_entries(account_id,amount_paise,reason,idempotency_key) select id,100000,'dev_seed','orgfund-" + orgId + "' from ledger_accounts where org_id='" + orgId + "'");
  // member works inside the organisation
  await member.goto(B + '/projects'); await member.click('button:has-text("New artwork in Acme Print Buyers")'); await member.waitForURL(/projects\/[0-9a-f-]{36}/); const pid = member.url().split('/').pop();
  await member.setInputFiles('#file', '/tmp/claude-0/-home-claude/95a4dd48-6c0d-5f4d-a4fb-00a770008b56/scratchpad/art.png'); await member.waitForSelector('text=All changes saved', { timeout: 15000 }); await member.waitForTimeout(500);
  await member.click('text=Get price'); await member.waitForSelector('text=Hold funds'); await member.click('text=Hold funds and queue job'); await member.waitForURL(/jobs\//); await member.waitForSelector('text=Download', { timeout: 30000 }); console.log('member job finished using shared credit');
  console.log('personal credit untouched:', sql("select coalesce(sum(amount_paise),0) from ledger_entries e join ledger_accounts a on a.id=e.account_id join users u on u.id=a.owner_user_id where u.email='new.customer@example.test'"), '| org balance after:', sql("select sum(amount_paise) from ledger_entries e join ledger_accounts a on a.id=e.account_id where a.org_id='" + orgId + "'"));
  // admin sees spend; cannot open private project; can export CSV
  await admin.goto(B + '/business'); await admin.waitForSelector('td:has-text("spent")'); console.log('admin usage row:', (await admin.locator('tbody tr').last().innerText()).replace(/\s+/g, ' '));
  await admin.goto(B + '/projects/' + pid); await admin.waitForSelector('p.err:not(:empty)'); console.log('admin on private project:', await admin.locator('p.err').first().innerText());
  const csv = await admin.evaluate(async id => { const r = await fetch('/api/orgs/' + id + '/usage?format=csv'); return [r.status, r.headers.get('content-type'), (await r.text()).split('\n')[0]]; }, orgId); console.log('csv:', JSON.stringify(csv));
  const memberCsv = await member.evaluate(async id => (await fetch('/api/orgs/' + id + '/usage?format=csv')).status, orgId); console.log('member csv status:', memberCsv);
  // limit blocks further spend
  await admin.goto(B + '/business'); await admin.waitForSelector('input[aria-label^="Monthly limit for new.customer"]'); await admin.fill('input[aria-label^="Monthly limit for new.customer"]', '0.01'); await admin.click('tr:has-text("new.customer") button:has-text("Save")'); await admin.waitForSelector('text=Limit saved');
  await member.goto(B + '/projects/' + pid); await member.waitForSelector('text=Get price'); await member.click('text=Get price'); await member.waitForSelector('text=Hold funds'); await member.click('text=Hold funds and queue job'); await member.waitForSelector('p.err:not(:empty)'); console.log('over-limit message:', await member.locator('p.err').first().innerText());
  // sharing
  await member.locator('input[type=checkbox]').click(); await member.waitForFunction(() => document.querySelector('input[type=checkbox]').checked); await admin.goto(B + '/projects/' + pid); await admin.waitForSelector('text=Shared with you'); console.log('admin sees shared project read-only; file input disabled:', await admin.locator('#file').isDisabled());
  await admin.screenshot({ path: '/tmp/claude-0/-home-claude/95a4dd48-6c0d-5f4d-a4fb-00a770008b56/scratchpad/business.png', fullPage: true });
  console.log('page errors:', JSON.stringify(errs)); await b.close();
})().catch(e => { console.error('E2E FAIL', e.message.split('\n')[0]); process.exit(1); });
