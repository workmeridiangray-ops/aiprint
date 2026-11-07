import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkActor, closePool } from './helpers';
import { login, resolveActor, createUser } from '../src/server/auth';
import { saveOriginal, readOriginal, inspectImage } from '../src/server/files';
import { createProject, getProject, saveProject } from '../src/server/projects';
import { can } from '../src/server/policy';
import { getPool } from '../src/server/db';

let A: string, B: string;
beforeAll(async () => { await setupDb(); A = await mkTenant('Vendor A'); B = await mkTenant('Vendor B'); });
afterAll(closePool);
const png = (w = 100, h = 100) => sharp({ create: { width: w, height: h, channels: 3, background: '#888' } }).png().toBuffer();

describe('authentication', () => {
  it('rejects wrong password and unknown user identically', async () => {
    await mkActor(A, 'a1@x.test');
    await expect(login('a1@x.test', 'wrong-password-123')).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(login('nobody@x.test', 'wrong-password-123')).rejects.toMatchObject({ code: 'invalid_credentials' });
  });
  it('rejects weak passwords and duplicate emails (case-insensitive)', async () => {
    await expect(createUser('w@x.test', 'short', A, 'customer')).rejects.toMatchObject({ code: 'weak_password' });
    await expect(createUser('A1@X.test', 'correct-horse-battery', A, 'customer')).rejects.toMatchObject({ code: 'email_taken' });
  });
  it('expired and missing sessions are refused', async () => {
    const { token } = await login('a1@x.test', 'correct-horse-battery');
    await getPool().query("update sessions set expires_at = now() - interval '1 minute'");
    await expect(resolveActor(token, A)).rejects.toMatchObject({ code: 'session_expired' });
    await expect(resolveActor(undefined, A)).rejects.toMatchObject({ code: 'unauthenticated' });
  });
  it('a client cannot claim a tenant it has no membership in', async () => {
    const { token } = await login('a1@x.test', 'correct-horse-battery');
    await expect(resolveActor(token, B)).rejects.toMatchObject({ code: 'denied' });
  });
  it('revoked membership loses access immediately', async () => {
    await mkActor(A, 'rev@x.test');
    const { token } = await login('rev@x.test', 'correct-horse-battery');
    await getPool().query("update memberships set revoked_at=now() where user_id=(select id from users where email='rev@x.test')");
    await expect(resolveActor(token, A)).rejects.toMatchObject({ code: 'denied' });
  });
});

describe('tenant and record isolation', () => {
  it('other tenants and other users cannot read or save a project or file; errors look like not-found', async () => {
    const alice = await mkActor(A, 'alice@x.test'), mallory = await mkActor(B, 'mallory@x.test'), sameTenantBob = await mkActor(A, 'bob@x.test');
    const p = await createProject(alice, 'Poster');
    const f = await saveOriginal(alice, await png());
    for (const other of [mallory, sameTenantBob]) {
      await expect(getProject(other, p.id)).rejects.toMatchObject({ code: 'not_found', status: 404 });
      await expect(saveProject(other, p.id, 1, {})).rejects.toMatchObject({ code: 'not_found' });
      await expect(readOriginal(other, f.fileId)).rejects.toMatchObject({ code: 'not_found' });
      await expect(saveProject(other, p.id, 1, { sourceFileId: f.fileId })).rejects.toMatchObject({ code: 'not_found' });
    }
    expect((await readOriginal(alice, f.fileId)).length).toBeGreaterThan(0);
  });
  it('cannot attach another user\'s file as a project source', async () => {
    const u1 = await mkActor(A, 'own1@x.test'), u2 = await mkActor(A, 'own2@x.test');
    const f = await saveOriginal(u1, await png());
    const p = await createProject(u2, 'Mine');
    await expect(saveProject(u2, p.id, 1, { sourceFileId: f.fileId })).rejects.toMatchObject({ code: 'invalid_source' });
  });
  it('deny by default: unknown roles and staff roles get no artwork access', () => {
    const base = { tenantId: A, ownerUserId: 'u' };
    for (const role of ['vendor_admin', 'vendor_finance', 'vendor_support', 'platform_owner', 'platform_support', 'nonsense'])
      expect(can({ userId: 'u', tenantId: A, role }, 'file.read', base)).toBe(false);
    expect(can({ userId: 'u', tenantId: B, role: 'customer' }, 'file.read', base)).toBe(false);
  });
});

describe('upload inspection limits', () => {
  it('accepts valid png and jpeg', async () => {
    expect((await inspectImage(await png(50, 40))).width).toBe(50);
    const jpg = await sharp({ create: { width: 30, height: 30, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    expect((await inspectImage(jpg)).format).toBe('jpeg');
  });
  it('rejects other formats, garbage, empty, truncated', async () => {
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).gif().toBuffer();
    await expect(inspectImage(gif)).rejects.toMatchObject({ code: 'unsupported_format' });
    await expect(inspectImage(Buffer.from('not an image'))).rejects.toMatchObject({ code: 'unreadable_image' });
    await expect(inspectImage(Buffer.alloc(0))).rejects.toMatchObject({ code: 'empty_file' });
    const good = await png(400, 400);
    await expect(inspectImage(good.subarray(0, Math.floor(good.length / 2)))).rejects.toBeDefined();
  });
  it('rejects over 25 MB without decoding', async () => {
    await expect(inspectImage(Buffer.alloc(25 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: 'file_too_large' });
  });
  it('rejects over 40 megapixels', async () => {
    const big = await sharp({ create: { width: 8001, height: 5001, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    await expect(inspectImage(big)).rejects.toMatchObject({ code: expect.stringMatching(/unreadable_image|too_many_pixels/) });
  });
  it('reports untagged colour profile explicitly', async () => {
    const u = await mkActor(A, 'prof@x.test');
    expect((await saveOriginal(u, await png())).colourProfile).toBe('untagged');
  });
});

describe('sign-in audit trail', () => {
  it('records failed passwords and issued sessions without storing the email, password or token', async () => {
    const { getPool } = await import('../src/server/db'); const { createUser, login } = await import('../src/server/auth');
    const t = await mkTenant('Audit Auth'); const email = 'audit-auth@x.test';
    await createUser(email, 'correct-horse-battery', t, 'customer');
    const before = Number((await getPool().query("select count(*) n from audit_log where action like 'auth.%'")).rows[0].n);
    await expect(login(email, 'wrong-password-123', 'src-a')).rejects.toMatchObject({ status: 401 });
    await expect(login('nobody-here@x.test', 'wrong-password-123', 'src-a')).rejects.toMatchObject({ status: 401 });
    const { token } = await login(email, 'correct-horse-battery', 'src-a');
    const rows = (await getPool().query("select action, outcome, actor_user_id, object_type, object_id from audit_log where action like 'auth.%' order by id desc limit 3")).rows;
    expect(Number((await getPool().query("select count(*) n from audit_log where action like 'auth.%'")).rows[0].n) - before).toBe(3);
    expect(rows.map((r: any) => r.action).sort()).toEqual(['auth.password_failed', 'auth.password_failed', 'auth.session_issued']);
    expect(rows.filter((r: any) => r.action === 'auth.password_failed' && r.actor_user_id === null)).toHaveLength(1); // unknown email: no actor, no email stored
    expect(JSON.stringify(rows)).not.toContain(email); expect(JSON.stringify(rows)).not.toContain(token!);
  });
});

describe('audit coverage and tamper resistance', () => {
  it('audit rows cannot be changed or deleted', async () => {
    const { getPool } = await import('../src/server/db'); const p = getPool();
    await p.query("insert into audit_log(action,outcome) values('test.immutable','ok')");
    await expect(p.query("update audit_log set outcome='x' where action='test.immutable'")).rejects.toThrow(/append-only/);
    await expect(p.query("delete from audit_log where action='test.immutable'")).rejects.toThrow(/append-only/);
  });
  it('records lockout once at the limit, failed codes, logout, project, file and quote events', async () => {
    const { getPool } = await import('../src/server/db'); const p = getPool(); const { createUser, login, logout } = await import('../src/server/auth');
    const { createProject, saveProject } = await import('../src/server/projects'); const { createQuote } = await import('../src/server/quotes'); const { fund } = await import('./helpers');
    const t = await mkTenant('Audit Cov'); const email = 'audit-cov@x.test'; await createUser(email, 'correct-horse-battery', t, 'customer');
    const n = async (a: string) => Number((await p.query("select count(*) n from audit_log where action=$1", [a])).rows[0].n);
    const lock0 = await n('auth.locked_out');
    for (let i = 0; i < 8; i++) await login(email, 'wrong-password-123', 'src-lock').catch(() => {});
    expect(await n('auth.locked_out') - lock0).toBe(1); // 5th failure crosses the limit; later blocked tries add nothing
    await p.query('delete from login_failures');
    const out0 = await n('auth.logout'); const { token } = await login(email, 'correct-horse-battery', 'src-ok'); await logout(token!); expect(await n('auth.logout') - out0).toBe(1);
    const [pr0, f0, q0] = [await n('project.create'), await n('file.upload'), await n('quote.create')];
    const u = await mkActor(t, 'audit-cov2@x.test'); const proj = await createProject(u, 'A');
    const f = await saveOriginal(u, await sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6' } }).png().toBuffer());
    await saveProject(u, proj.id, 1, { sourceFileId: f.fileId, settings: { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' } });
    await fund(t, u.userId, 100000, 'ac-c'); await createQuote(u, proj.id);
    expect([await n('project.create') - pr0, await n('file.upload') - f0, await n('quote.create') - q0]).toEqual([1, 1, 1]);
  });
});
