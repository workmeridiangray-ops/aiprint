import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import IORedis from 'ioredis';
import sharp from 'sharp';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import { notifyJob, waitForJob, queueHealth, closeQueue } from '../src/server/queue';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { workOnce, jobStatus, reapExpired } from '../src/server/worker';
import { getPool } from '../src/server/db';

const PORT = 6391; const URL = `redis://127.0.0.1:${PORT}`; let redis: ChildProcess | null = null; let probe: IORedis; let T: string; let n = 0;
const start = async () => { redis = spawn('redis-server', ['--port', String(PORT), '--save', '', '--appendonly', 'no', '--bind', '127.0.0.1'], { stdio: 'ignore' }); for (let i = 0; i < 50; i++) { try { const c = new IORedis(URL, { lazyConnect: true, maxRetriesPerRequest: 0 }); await c.connect(); await c.ping(); c.disconnect(); return; } catch { await new Promise(r => setTimeout(r, 100)); } } throw new Error('redis did not start'); };
const stop = async () => { redis?.kill('SIGKILL'); redis = null; await new Promise(r => setTimeout(r, 300)); };
beforeAll(async () => { await setupDb(); T = await mkTenant('Q'); await start(); process.env.REDIS_URL = URL; probe = new IORedis(URL); probe.on('error', () => {}); });
afterAll(async () => { await closeQueue(); probe.disconnect(); await stop(); delete process.env.REDIS_URL; await closePool(); });
afterEach(async () => { if (redis) await probe.del('artwork:jobs'); });
const png = () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#c40' } }).png().toBuffer();
async function ready() {
  const u = await mkActor(T, `q${++n}@x.test`); const p = await createProject(u, 'Q' + n); const f = await saveOriginal(u, await png());
  await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' } });
  await fund(T, u.userId, 100000, 'qc' + n); await fund(T, null, 1_000_000, 'qv' + n); return { u, q: await createQuote(u, p.id) };
}
const ledgerSum = async () => Number((await getPool().query('select coalesce(sum(amount_paise),0)::bigint s from ledger_entries')).rows[0].s);

describe('signals', () => {
  it('reserving signals the worker once, after commit; a repeated request does not signal again', async () => {
    const { u, q } = await ready(); const r = await reserveQuote(u, q.quoteId);
    expect(await probe.lrange('artwork:jobs', 0, -1)).toEqual([r.jobId]);
    const again = await reserveQuote(u, q.quoteId); expect(again.repeated).toBe(true); expect(await probe.llen('artwork:jobs')).toBe(1);
    expect(await waitForJob(2)).toBe(true); expect(await waitForJob(1)).toBe(false); // consumed, then a quiet timeout
    while (await workOnce('w')) { /* drain */ }
  });
  it('a stale or duplicate signal is harmless: nothing to claim, nothing charged twice', async () => {
    const { u, q } = await ready(); const r = await reserveQuote(u, q.quoteId); while (await workOnce('w')) { /* drain */ }
    const before = await ledgerSum(); await notifyJob(r.jobId); await notifyJob(r.jobId); await notifyJob('00000000-0000-0000-0000-000000000000');
    expect(await workOnce('w')).toBe(false); expect(await ledgerSum()).toBe(before); expect((await jobStatus(u, r.jobId)).status).toBe('succeeded');
  });
  it('a job requeued by the reaper is signalled again', async () => {
    const { u, q } = await ready(); const r = await reserveQuote(u, q.quoteId); await probe.del('artwork:jobs');
    await getPool().query("update jobs set status='running', attempts=1, lease_owner='dead', lease_expires_at=now()-interval '1 minute' where id=$1", [r.jobId]);
    expect((await reapExpired()).requeued).toBeGreaterThanOrEqual(1); expect(await probe.lrange('artwork:jobs', 0, -1)).toContain(r.jobId);
    while (await workOnce('w')) { /* drain */ }
  });
  it('reports health', async () => { expect(await queueHealth()).toMatchObject({ configured: true, reachable: true }); });
});

describe('Redis down or not configured', () => {
  it('losing Redis never loses a job: the request still succeeds quickly and polling still processes it', async () => {
    const { u, q } = await ready(); await stop();
    const t0 = Date.now(); const r = await reserveQuote(u, q.quoteId); expect(Date.now() - t0).toBeLessThan(4000); expect(r.repeated).toBe(false);
    expect(await notifyJob(r.jobId)).toBe(false); expect(await queueHealth()).toMatchObject({ configured: true, reachable: false });
    while (await workOnce('w')) { /* the polling path */ } expect((await jobStatus(u, r.jobId)).status).toBe('succeeded');
    expect(await waitForJob(1)).toBe(false); // the worker loop falls back to timing, it does not crash
  }, 30000);
  it('comes back by itself when Redis returns', async () => {
    await start(); const { u, q } = await ready(); let ok = false; for (let i = 0; i < 20 && !ok; i++) { await new Promise(r => setTimeout(r, 500)); ok = (await queueHealth() as any).reachable === true; } expect(ok).toBe(true);
    const r = await reserveQuote(u, q.quoteId); expect(await probe.llen('artwork:jobs')).toBeGreaterThanOrEqual(0); while (await workOnce('w')) { /* drain */ } expect((await jobStatus(u, r.jobId)).status).toBe('succeeded');
  }, 30000);
  it('without REDIS_URL nothing is attempted and the system still works', async () => {
    const keep = process.env.REDIS_URL; delete process.env.REDIS_URL;
    expect(await notifyJob('x')).toBe(false); expect(await queueHealth()).toEqual({ configured: false });
    const { u, q } = await ready(); const r = await reserveQuote(u, q.quoteId); while (await workOnce('w')) { /* drain */ } expect((await jobStatus(u, r.jobId)).status).toBe('succeeded'); process.env.REDIS_URL = keep;
  });
});
