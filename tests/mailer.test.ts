import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { readFileSync, readdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SMTPServer } from 'smtp-server';
import { setupDb, mkTenant, mkActor, closePool } from './helpers';
import { deliverPending, render, TEMPLATES, emailHealth, emailConfig, MAX_ATTEMPTS, type Transport, type Mail } from '../src/server/mailer';
import { getPool } from '../src/server/db';

beforeAll(async () => { await setupDb(); });
afterAll(closePool);
const ENV = ['EMAIL_DRIVER', 'SMTP_HOST', 'SMTP_PORT', 'EMAIL_FROM', 'APP_URL', 'APP_ENV', 'EMAIL_FILE_DIR'] as const; let saved: Record<string, string | undefined> = {};
beforeEach(async () => { saved = Object.fromEntries(ENV.map(k => [k, process.env[k]])); process.env.APP_URL = 'https://app.example.test'; process.env.EMAIL_FROM = 'noreply@example.test'; await getPool().query('delete from email_outbox'); });
afterEach(() => { for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
const q = (to: string, template: string, body: object = {}) => getPool().query('insert into email_outbox(to_email,template,body) values($1,$2,$3) returning id', [to, template, JSON.stringify(body)]).then(r => Number(r.rows[0].id));
const row = async (id: number) => (await getPool().query('select * from email_outbox where id=$1', [id])).rows[0];
const recorder = (fail?: (m: Mail, n: number) => Error | null) => { const sent: Mail[] = []; let n = 0; const t: Transport = { async send(m) { n++; const e = fail?.(m, n); if (e) throw e; sent.push(m); } }; return { t, sent }; };

describe('templates', () => {
  it('every template used anywhere in the server code exists', () => {
    const used = new Set<string>(); const dir = 'src/server';
    for (const f of readdirSync(dir)) { const s = readFileSync(path.join(dir, f), 'utf8');
      for (const m of s.matchAll(/email_outbox\(to_email,template,body\) values\(\$1,'(\w+)'/g)) used.add(m[1]);
      for (const m of s.matchAll(/queueEmail\(c, [^,]+, '(\w+)'/g)) used.add(m[1]);
      for (const m of s.matchAll(/notice\(c, [^,]+, '(\w+)'/g)) used.add(m[1]); }
    for (const k of ['7d', '1d', 'grace_start', 'expired']) used.add('subscription_' + k);
    expect(used.size).toBeGreaterThanOrEqual(12);
    for (const t of used) expect(TEMPLATES[t], `missing template ${t}`).toBeTypeOf('function');
  });
  it('links carry the token and point at pages that exist', () => {
    const base = 'https://app.example.test';
    expect(render('verify_email', '{"token":"a b"}').text).toContain(`${base}/verify?token=a%20b`);
    expect(render('reset_password', '{"token":"T"}').text).toContain(`${base}/reset?token=T`);
    expect(render('invite', '{"token":"T"}').text).toContain(`${base}/invite?token=T`);
    expect(render('org_invite', '{"token":"T"}').text).toContain(`${base}/business/join?token=T`);
    expect(existsSync('src/app/invite/page.tsx') && existsSync('src/app/verify/page.tsx') && existsSync('src/app/reset/page.tsx') && existsSync('src/app/business/join/page.tsx')).toBe(true);
    expect(render('retention_warning', '{"expiresAt":"2026-12-01T10:00:00Z"}').text).toContain('1 December 2026');
  });
  it('production without APP_URL refuses to build links', () => { process.env.APP_ENV = 'production'; delete process.env.APP_URL; expect(() => render('verify_email', '{"token":"T"}')).toThrow(/APP_URL/); });
});

describe('delivery', () => {
  it('sends, marks sent, and scrubs the token from the stored row', async () => {
    const id = await q('u@x.test', 'reset_password', { token: 'SECRET-TOKEN' }); const r = recorder();
    expect(await deliverPending({ transport: r.t })).toMatchObject({ sent: 1, failed: 0, retried: 0 });
    expect(r.sent[0].to).toBe('u@x.test'); expect(r.sent[0].text).toContain('SECRET-TOKEN'); expect(r.sent[0].messageId).toBe('<outbox-' + id + '@example.test>');
    const s = await row(id); expect(s.status).toBe('sent'); expect(s.sent_at).not.toBeNull(); expect(s.body).toBe('{}');
    expect((await deliverPending({ transport: r.t })).sent).toBe(0); // never sent twice
  });
  it('temporary failures back off and retry; gives up after the maximum with the reason visible', async () => {
    const id = await q('u@x.test', 'enquiry_ack', { reference: 'ENQ-1' }); const r = recorder(() => new Error('connection reset'));
    expect(await deliverPending({ transport: r.t })).toMatchObject({ retried: 1 });
    let s = await row(id); expect(s.status).toBe('pending'); expect(s.attempts).toBe(1); expect(new Date(s.next_attempt_at).getTime()).toBeGreaterThan(Date.now() + 30000); expect(s.last_error).toContain('connection reset');
    expect((await deliverPending({ transport: r.t })).retried).toBe(0); // not due yet
    for (let i = 1; i < MAX_ATTEMPTS; i++) { await getPool().query('update email_outbox set next_attempt_at=now() where id=$1', [id]); await deliverPending({ transport: r.t }); }
    s = await row(id); expect(s.status).toBe('failed'); expect(s.attempts).toBe(MAX_ATTEMPTS); expect(s.last_error).toContain('connection reset'); expect(s.body).toBe('{}');
  });
  it('a permanent rejection (5xx) fails at once', async () => {
    const id = await q('bad@x.test', 'enquiry_ack', { reference: 'R' }); const r = recorder(() => Object.assign(new Error('550 mailbox unavailable'), { responseCode: 550 }));
    expect(await deliverPending({ transport: r.t })).toMatchObject({ failed: 1, retried: 0 }); expect((await row(id)).status).toBe('failed');
  });
  it('unknown template and bad recipient fail without calling the transport', async () => {
    const a = await q('u@x.test', 'no_such_template'); const b = await q('victim@x.test\r\nBcc: spy@x.test', 'enquiry_ack', { reference: 'R' }); let calls = 0;
    const out = await deliverPending({ transport: { async send() { calls++; } } });
    expect(out.failed).toBe(2); expect(calls).toBe(0); expect((await row(a)).last_error).toContain('unknown email template'); expect((await row(b)).last_error).toContain('invalid recipient');
  });
  it('two senders at once never send the same message twice', async () => {
    const ids = []; for (let i = 0; i < 20; i++) ids.push(await q(`p${i}@x.test`, 'enquiry_ack', { reference: 'R' + i }));
    const seen: string[] = []; const t: Transport = { async send(m) { await new Promise(r => setTimeout(r, 5)); seen.push(m.messageId); } };
    await Promise.all([deliverPending({ transport: t, limit: 12 }), deliverPending({ transport: t, limit: 12 })]);
    await deliverPending({ transport: t });
    expect(seen).toHaveLength(20); expect(new Set(seen).size).toBe(20);
  });
  it('a leased row is skipped, and picked up again once the lease ends (crash recovery)', async () => {
    const id = await q('u@x.test', 'enquiry_ack', { reference: 'R' }); const r = recorder();
    await getPool().query("update email_outbox set locked_until=now()+interval '4 minutes' where id=$1", [id]);
    expect((await deliverPending({ transport: r.t })).sent).toBe(0);
    await getPool().query("update email_outbox set locked_until=now()-interval '1 second' where id=$1", [id]);
    expect((await deliverPending({ transport: r.t })).sent).toBe(1);
  });
});

describe('configuration fails closed', () => {
  it('nothing is marked sent when no driver is configured', async () => {
    delete process.env.EMAIL_DRIVER; const id = await q('u@x.test', 'enquiry_ack', { reference: 'R' });
    const out = await deliverPending(); expect(out.blocked).toMatch(/EMAIL_DRIVER/); expect(out.sent).toBe(0); expect((await row(id)).status).toBe('pending'); expect((await row(id)).attempts).toBe(0);
  });
  it('production refuses the file driver and incomplete SMTP settings', () => {
    process.env.APP_ENV = 'production'; process.env.EMAIL_DRIVER = 'file'; expect(emailConfig()).toMatchObject({ ok: false });
    process.env.EMAIL_DRIVER = 'smtp'; delete process.env.SMTP_HOST; delete process.env.SMTP_PORT; expect(emailConfig()).toMatchObject({ ok: false, reason: expect.stringContaining('SMTP_HOST') });
  });
  it('staff see queue health; others cannot', async () => {
    delete process.env.EMAIL_DRIVER; await q('u@x.test', 'enquiry_ack', { reference: 'R' }); await getPool().query("insert into email_outbox(to_email,template,body,status) values('f@x.test','enquiry_ack','{}','failed')");
    const P = await mkTenant('Platform', 'platform'); const staff = await mkActor(P, 'staff-m@x.test', 'platform_owner'); const h = await emailHealth(staff);
    expect(h).toMatchObject({ configured: false, pending: 1, failed: 1 }); expect(JSON.stringify(h)).not.toContain('@x.test');
    const V = await mkTenant('V'); await expect(emailHealth(await mkActor(V, 'cust-m@x.test'))).rejects.toMatchObject({ code: 'denied' });
  });
});

describe('real transports', () => {
  it('file driver writes a readable message (development only)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'mail-')); process.env.EMAIL_DRIVER = 'file'; process.env.EMAIL_FILE_DIR = dir; process.env.APP_ENV = 'test';
    await q('dev@x.test', 'verify_email', { token: 'T1' }); expect((await deliverPending()).sent).toBe(1);
    const f = readdirSync(dir)[0]; expect(readFileSync(path.join(dir, f), 'utf8')).toContain('/verify?token=T1');
  });
  it('delivers through a real SMTP conversation', async () => {
    const got: string[] = [];
    const server = new SMTPServer({ authOptional: true, disabledCommands: ['STARTTLS'], onData(stream, _s, cb) { let d = ''; stream.on('data', c => (d += c)); stream.on('end', () => { got.push(d); cb(); }); } });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); const port = (server.server.address() as any).port;
    process.env.EMAIL_DRIVER = 'smtp'; process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(port); process.env.APP_ENV = 'test';
    const id = await q('real@x.test', 'org_invite', { token: 'ORG-T' });
    try { expect(await deliverPending()).toMatchObject({ sent: 1 }); } finally { await new Promise(r => server.close(() => r(null))); }
    expect(got).toHaveLength(1);
    const qp = (x: string) => x.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16))); // what a mail client does
    got[0] = qp(got[0]); expect(got[0]).toMatch(/To: real@x\.test/); expect(got[0]).toMatch(/Subject: You have been invited to join an organisation/); expect(got[0]).toContain('/business/join?token=ORG-T'); expect(got[0]).toContain(`<outbox-${id}@example.test>`);
  });
  it('an unreachable SMTP server leaves the message pending, not sent', async () => {
    process.env.EMAIL_DRIVER = 'smtp'; process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = '1'; process.env.APP_ENV = 'test';
    const id = await q('u@x.test', 'enquiry_ack', { reference: 'R' }); expect(await deliverPending()).toMatchObject({ sent: 0, retried: 1 });
    const s = await row(id); expect(s.status).toBe('pending'); expect(s.last_error).toBeTruthy();
  });
});
