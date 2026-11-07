// Manual browser check of two-step sign-in. Needs dev DB with platform users, server on :3113 started with default MFA_REQUIRED_ROLES (platform roles required).
const { chromium } = require('playwright'); const crypto = require('crypto'); const { Client } = require('pg');
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const unb32 = s => { let bits = 0, v = 0; const out = []; for (const ch of s) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const hotp = (key, c) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(c)); const h = crypto.createHmac('sha1', key).update(b).digest(); const o = h[19] & 15; return String((((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); };
const step = () => Math.floor(Date.now() / 30000);
(async () => {
  const B = 'http://localhost:3113'; const b = await chromium.launch(); const errs = [];
  const page = async () => { const ctx = await b.newContext({ viewport: { width: 900, height: 900 } }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); return p; };
  const signIn = async (p, email, pw = 'dev-password-12345') => { await p.goto(B + '/login'); await p.fill('#email', email); await p.fill('#password', pw); await p.click('button:has-text("Sign in")'); };
  // 1. required role: forced to enrol, blocked from admin until done
  let p = await page(); await signIn(p, 'dev.owner@example.test'); await p.waitForURL('**/account/security'); console.log('required role sent to setup:', true);
  const api = await p.evaluate(() => fetch('/api/platform/overview').then(r => r.status)); console.log('admin API blocked before setup (403):', api === 403);
  await p.click('button:has-text("Set up")'); await p.waitForSelector('[data-testid=secret]'); const secret = await p.innerText('[data-testid=secret]'); const key = unb32(secret);
  console.log('QR shown:', await p.locator('img[alt^="QR"]').count() === 1);
  await p.fill('#cc', '000000'); await p.click('button:has-text("Turn on")'); await p.waitForSelector('.err:has-text("not right")'); console.log('wrong code rejected: true');
  await p.fill('#cc', hotp(key, step())); await p.click('button:has-text("Turn on")'); await p.waitForSelector('[data-testid=recovery-codes]');
  const codes = (await p.innerText('[data-testid=recovery-codes]')).trim().split('\n'); console.log('recovery codes shown:', codes.length);
  await p.screenshot({ path: process.argv[2] || 'mfa.png' }); await p.click('text=I have saved them');
  console.log('admin API works after setup:', await p.evaluate(() => fetch('/api/platform/overview').then(r => r.status)) === 200);
  // 2. sign in again: password alone is not enough
  p = await page(); await signIn(p, 'dev.owner@example.test'); await p.waitForSelector('#code'); console.log('asks for code after password:', true);
  console.log('no session yet:', await p.evaluate(() => fetch('/api/platform/overview').then(r => r.status)) === 401);
  await p.fill('#code', '111111'); await p.click('button:has-text("Verify")'); await p.waitForSelector('.err:has-text("not right")'); console.log('wrong code rejected: true');
  await p.fill('#code', hotp(key, step() + 1)); await p.click('button:has-text("Verify")'); await p.waitForURL('**/admin'); console.log('valid code signs in, lands on /admin: true');
  // 3. recovery code
  p = await page(); await signIn(p, 'dev.owner@example.test'); await p.waitForSelector('#code'); await p.fill('#code', codes[0]); await p.click('button:has-text("Verify")'); await p.waitForURL('**/admin'); console.log('recovery code signs in: true');
  p = await page(); await signIn(p, 'dev.owner@example.test'); await p.waitForSelector('#code'); await p.fill('#code', codes[0]); await p.click('button:has-text("Verify")'); await p.waitForSelector('.err:has-text("not right")'); console.log('recovery code reuse rejected: true');
  // 4. lockout message (unknown email so no real account is locked)
  p = await page(); for (let i = 0; i < 6; i++) { await signIn(p, 'nobody-e2e@example.test', 'wrong-password-123'); await p.waitForSelector('.err:not(:empty)'); }
  console.log('lockout message:', await p.innerText('.err'));
  // cleanup so other scripts see the original dev state
  const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect();
  await db.query("update users set mfa_secret=null, mfa_pending_secret=null, mfa_enabled_at=null, mfa_last_step=null where email like 'dev.%'"); await db.query("delete from mfa_recovery_codes"); await db.query("delete from login_failures"); await db.end();
  console.log('page errors:', JSON.stringify(errs.filter(e => !/40[0-9]/.test(e)))); await b.close();
})().catch(e => { console.error('E2E FAIL', e.message); process.exit(1); });
