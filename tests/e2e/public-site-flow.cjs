const { chromium } = require('playwright');
const { execSync } = require('child_process');
const B = process.env.E2E_BASE || 'http://localhost:3113'; const DB = process.env.DATABASE_URL;
const sql = q => execSync('psql "' + DB + '" -tAc "' + q.replace(/"/g, '\\"') + '"').toString().trim();
const PAGES = ['/', '/software', '/services', '/how-it-works', '/plans', '/pricing', '/faq', '/contact', '/terms', '/privacy', '/refund-policy', '/acceptable-use'];
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1100, height: 900 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  const audit = async (label) => { const titles = new Set(); const bad = [];
    for (const u of PAGES) { const r = await p.goto(B + u); const h1 = await p.locator('h1').count(); const t = await p.title(); const txt = await p.locator('body').innerText();
      if (r.status() !== 200 || h1 !== 1) bad.push(u + ' status ' + r.status() + ' h1 ' + h1); if (titles.has(t)) bad.push(u + ' duplicate title'); titles.add(t);
      if (/SC-\d{3}|\bAPI\b|tenant|lorem|coming soon|TODO|AI-powered/i.test(txt)) bad.push(u + ' has developer/filler text'); }
    console.log(label, 'pages ok:', PAGES.length - bad.length, '/', PAGES.length, bad.length ? JSON.stringify(bad) : ''); };
  await audit('empty-state audit');
  await p.goto(B + '/pricing'); console.log('/pricing empty:', (await p.locator('.card').innerText()));
  await p.goto(B + '/terms'); console.log('/terms empty:', (await p.locator('[role=status]').innerText()));
  // platform owner sets up direct store, price and a policy through the real API
  const o = await b.newContext(); const op = await o.newPage(); await op.goto(B + '/login'); await op.fill('#email', 'dev.owner@example.test'); await op.fill('#password', 'dev-password-12345'); await op.click('button'); await op.waitForURL('**/projects');
  const post = (url, body) => op.evaluate(async ([u, b]) => { const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }); return [r.status, await r.json()]; }, [url, body]);
  const ds = await post('/api/platform/direct-store', { name: 'Direct Store', slug: 'direct-store' }); console.log('create direct store:', ds[0]);
  sql("insert into vendor_pricing(tenant_id,per_mp_paise,min_paise) values('" + ds[1].tenantId + "',800,2500)");
  const pol = await post('/api/platform/policies', { slug: 'terms', effectiveDate: '2026-12-01', body: 'First paragraph of the approved terms.\n\nSecond paragraph.', approvedByName: 'Test Approver' }); console.log('publish policy:', pol[0]);
  console.log('support cannot publish:', (await (async () => { const s = await b.newContext(); const sp = await s.newPage(); await sp.goto(B + '/login'); await sp.fill('#email', 'dev.support@example.test'); await sp.fill('#password', 'dev-password-12345'); await sp.click('button'); await sp.waitForURL('**/projects');
    return sp.evaluate(async () => (await fetch('/api/platform/policies', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'privacy', effectiveDate: '2026-12-01', body: 'x', approvedByName: 'y' }) })).status); })()));
  await audit('populated audit');
  await p.goto(B + '/pricing'); console.log('/pricing rows:', await p.locator('tbody tr').count(), '|', (await p.locator('tbody tr').nth(2).innerText()).replace(/\s+/g, ' '));
  await p.goto(B + '/terms'); console.log('/terms:', (await p.locator('.muted').first().innerText()), '| paragraphs:', await p.locator('.policy p').count());
  await p.goto(B + '/plans'); console.log('plans cards:', await p.locator('.cards .card').count());
  const sm = await (await ctx.request.get(B + '/sitemap.xml')).text(); console.log('sitemap urls:', (sm.match(/<loc>/g) || []).length); console.log('robots disallows /api/:', (await (await ctx.request.get(B + '/robots.txt')).text()).includes('Disallow: /api/'));
  // enquiry form
  await p.goto(B + '/contact'); await p.click('text=Send enquiry'); await p.waitForSelector('#name-err');
  console.log('enquiry errors:', await p.locator('.err').count(), '| name aria-invalid:', await p.getAttribute('#name', 'aria-invalid'));
  await p.fill('#name', 'Asha'); await p.fill('#email', 'asha@example.test'); await p.fill('#subject', 'Plans'); await p.fill('#message', 'Do you support A3?'); await p.click('text=Send enquiry'); await p.waitForSelector('#consent-err');
  await p.check('input[name=consent]'); await p.click('text=Send enquiry'); await p.waitForSelector('text=Your reference is');
  const ref = await p.locator('strong').innerText(); console.log('enquiry reference:', ref, '| stored:', sql("select count(*) from enquiries where reference='" + ref + "'"));
  // store, register, verify, sign in
  await p.goto(B + '/store/dev-sample'); console.log('store h1:', await p.locator('h1').innerText()); const r404 = await p.goto(B + '/store/no-such-store'); console.log('unknown store status:', r404.status());
  await p.goto(B + '/register'); console.log('register without store:', (await p.locator('[role=alert]').first().innerText()).slice(0, 40));
  await p.goto(B + '/register?store=dev-sample'); await p.fill('#email', 'new.customer@example.test'); await p.fill('#password', 'a-long-password-123'); await p.click('text=Create account'); await p.waitForSelector('text=Check your email');
  const tok = JSON.parse(sql("select body from email_outbox where to_email='new.customer@example.test' and template='verify_email'")).token;
  await p.goto(B + '/verify?token=' + tok); await p.waitForSelector('text=Email verified'); await p.goto(B + '/login'); await p.fill('#email', 'new.customer@example.test'); await p.fill('#password', 'a-long-password-123'); await p.click('button'); await p.waitForURL('**/projects'); console.log('new customer signed in');
  // vendor signup with plan reference
  const plan = sql("select id from plans where code='dev' limit 1"); await p.goto(B + '/vendor-signup?plan=' + plan); await p.fill('#business', 'Browser Shop'); await p.fill('#slug', 'browser-shop'); await p.fill('#email', 'owner@browser-shop.test'); await p.fill('#password', 'a-long-password-123'); await p.click('button:has-text("Register")'); await p.waitForSelector('text=Check your email');
  console.log('vendor tenant status:', sql("select t.status from tenants t join vendor_profiles v on v.tenant_id=t.id where v.slug='browser-shop'"), '| plan ref stored:', sql("select count(*) from subscriptions s join tenants t on t.id=s.tenant_id join vendor_profiles v on v.tenant_id=t.id where v.slug='browser-shop' and s.scheduled_plan_id='" + plan + "'"));
  await p.goto(B + '/vendor-signup'); console.log('signup without plan:', (await p.locator('[role=alert]').first().innerText()).slice(0, 30));
  // mobile + keyboard
  const m = await b.newContext({ viewport: { width: 390, height: 800 } }); const mp = await m.newPage(); const over = [];
  for (const u of PAGES.concat(['/store/dev-sample', '/register?store=dev-sample'])) { await mp.goto(B + u); if (await mp.evaluate(() => document.documentElement.scrollWidth > innerWidth)) over.push(u); }
  console.log('mobile overflow pages:', JSON.stringify(over));
  await mp.goto(B + '/'); await mp.keyboard.press('Tab'); console.log('first tab stop is skip link:', await mp.evaluate(() => document.activeElement.className));
  await mp.goto(B + '/pricing'); await mp.screenshot({ path: '/tmp/claude-0/-home-claude/95a4dd48-6c0d-5f4d-a4fb-00a770008b56/scratchpad/pricing-mobile.png' }); await p.goto(B + '/'); await p.screenshot({ path: '/tmp/claude-0/-home-claude/95a4dd48-6c0d-5f4d-a4fb-00a770008b56/scratchpad/home.png' });
  console.log('page errors:', JSON.stringify(errs)); await b.close();
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
