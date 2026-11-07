// Browser check of /vendor/settings (versions, staff two-step flag), the closure request/cancel/complete story, and /vendor/reports.
// Needs the dev seed, platform users (mkplatform.mts) and a server on E2E_BASE (default :3113) started with MFA_REQUIRED_ROLES= (empty).
const { chromium } = require('playwright'); const { Client } = require('pg');
(async () => {
  const B = process.env.E2E_BASE || 'http://localhost:3113'; const b = await chromium.launch(); const errs = []; const out = process.argv[2] || '.';
  const as = async (email, landing) => { const ctx = await b.newContext({ viewport: { width: 1100, height: 1000 } }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(email + ': ' + e.message));
    await p.goto(B + '/login'); await p.fill('#email', email); await p.fill('#password', 'dev-password-12345'); await p.click('button'); await p.waitForURL(landing); return p; };
  const check = (label, ok) => { console.log(label + ':', ok); if (!ok) throw new Error('check failed: ' + label); };
  const adm = await as('dev.admin@example.test', u => !u.pathname.startsWith('/login'));
  // settings: save twice, see versions, flag shows the staff count
  await adm.goto(B + '/vendor/settings'); await adm.waitForSelector('#be');
  await adm.fill('#be', 'billing@example.test'); await adm.fill('#sp', '+91 98765 43210'); await adm.check('input[name=mfa]'); await adm.click('button:has-text("Save")');
  await adm.waitForSelector('text=Saved as version 1'); check('first save is version 1', true);
  await adm.fill('#se', 'help@example.test'); await adm.click('button:has-text("Save")'); await adm.waitForSelector('text=Saved as version 2');
  await adm.waitForSelector('summary:has-text("Earlier versions")'); check('earlier versions listed', true);
  await adm.fill('#be', 'not an email'); await adm.click('button:has-text("Save")'); await adm.waitForTimeout(500); check('bad email blocked by the form before it is sent (server also refuses, see unit tests)', await adm.locator('#be').evaluate(el => !el.validity.valid) && !(await adm.innerText('main')).includes('Saved as version 3'));
  await adm.screenshot({ path: out + '/settings.png', fullPage: true });
  // the flag is on, so counter staff would be asked to enrol: switch it off again to keep the other checks independent
  await adm.reload(); await adm.waitForSelector('#be'); await adm.uncheck('input[name=mfa]'); await adm.click('button:has-text("Save")'); await adm.waitForSelector('text=Saved as version 3');
  // reports: tabs, filters, CSV link, scope
  await adm.goto(B + '/vendor/reports'); await adm.waitForSelector('table'); const tabs = await adm.locator('[role=tab]').count(); check('five report tabs', tabs === 5);
  for (const name of ['Counter receipts', 'Usage', 'Processing credit', 'Staff activity', 'Service sales']) { await adm.click(`[role=tab]:has-text("${name}")`); await adm.waitForSelector('table'); }
  await adm.fill('#from', '2999-01-01'); await adm.click('button:has-text("Show")'); await adm.waitForSelector('text=Nothing matches these filters'); check('future dates give an empty report', true);
  const href = await adm.locator('a:has-text("Download CSV")').getAttribute('href'); const csv = await adm.evaluate(h => fetch(h).then(async r => ({ s: r.status, t: r.headers.get('content-type'), b: await r.text() })), href);
  check('CSV downloads as text/csv with a header row', csv.s === 200 && /text\/csv/.test(csv.t) && /^Date \(IST\)/.test(csv.b));
  await adm.screenshot({ path: out + '/reports.png', fullPage: true });
  const ctr = await as('dev.counter@example.test', u => !u.pathname.startsWith('/login'));
  const st = await ctr.evaluate(() => fetch('/api/vendor/reports/sales').then(r => r.status)); check('counter staff refused (403)', st === 403);
  // closure: request, state shown, cancel
  await adm.goto(B + '/vendor/settings'); await adm.waitForSelector('#why'); const disabled0 = await adm.locator('button:has-text("Request closure")').isDisabled(); check('closure button waits for reason and tick', disabled0);
  await adm.fill('#why', 'Browser check, closing for real'); await adm.check('text=I understand new jobs stop immediately'); await adm.click('button:has-text("Request closure")');
  await adm.waitForSelector('text=Closure requested.'); await adm.screenshot({ path: out + '/closure-requested.png', fullPage: true });
  const own = await as('dev.owner@example.test', u => !u.pathname.startsWith('/login')); await own.goto(B + '/admin'); await own.waitForSelector('#closures'); check('platform owner sees the closure', (await own.locator('#closures').innerText()).includes('Browser check'));
  await own.click('button:has-text("Close this store")'); await own.waitForSelector('#closures .err'); check('completion refused during notice period', /notice period/i.test(await own.locator('#closures').innerText()));
  await own.screenshot({ path: out + '/closure-admin.png', fullPage: true });
  await adm.click('button:has-text("Cancel closure")'); await adm.waitForSelector('text=Closure cancelled.'); check('cancel restores the store', await adm.locator('#why').count() === 1);
  console.log('page errors:', errs.length ? errs : 'none'); await b.close(); if (errs.length) process.exit(1);
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
