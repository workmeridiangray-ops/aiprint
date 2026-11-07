import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote, cancelBeforeDispatch } from '../src/server/quotes';
import { claimJob, runJob, reapExpired, readOutput, jobStatus, workOnce } from '../src/server/worker';
import { balance } from '../src/server/ledger';
import { getPool } from '../src/server/db';

let T: string;
beforeAll(async () => { await setupDb(); T = await mkTenant('V'); });
afterAll(closePool);
const S = { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' as const };
const png = () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6' } }).png().toBuffer();
async function queued(email: string, credit = 100000, settings: object = S) {
  const u = await mkActor(T, email); const p = await createProject(u, 'P');
  const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings });
  const ca = await fund(T, u.userId, credit, `c-${email}`); const va = await fund(T, null, 1_000_000, `v-${email}`);
  const q = await createQuote(u, p.id); const r = await reserveQuote(u, q.quoteId);
  return { u, pid: p.id, q, r, ca, va };
}

describe('CMYK jobs', () => {
  it('a CMYK TIFF job runs through quote, queue and worker, is stored as CMYK and listed as CMYK', async () => {
    const x = await queued('cmyk1@x.test', 100000, { ...S, format: 'tiff', colour: 'cmyk' });
    expect(await workOnce('w-a')).toBe(true);
    const st = await jobStatus(x.u, x.r.jobId); expect(st.status).toBe('succeeded');
    const { buf } = await readOutput(x.u, st.outputId!);
    const m = await sharp(buf).metadata(); expect(m.space).toBe('cmyk'); expect(m.hasProfile).toBe(true);
    const row = (await getPool().query('select colour, format from outputs where id=$1', [st.outputId])).rows[0];
    expect(row).toEqual({ colour: 'cmyk', format: 'tiff' });
    const { listLibrary } = await import('../src/server/retention');
    const lib = await listLibrary(x.u); expect(lib.find((o: any) => o.id === st.outputId)).toMatchObject({ colour: 'cmyk', format: 'tiff' });
  });
  it('the price snapshot keeps the colour choice, so later project edits cannot change the paid file', async () => {
    const x = await queued('cmyk2@x.test', 100000, { ...S, format: 'pdf', colour: 'cmyk' });
    await saveProject(x.u, x.pid, 2, { settings: { ...S, format: 'pdf', colour: 'rgb' } });
    await workOnce('w-a');
    const st = await jobStatus(x.u, x.r.jobId);
    expect((await getPool().query('select colour from outputs where id=$1', [st.outputId])).rows[0].colour).toBe('cmyk');
  });
});

describe('processing', () => {
  it('produces a validated export with correct pixel size, consumes credit exactly once, entitles owner', async () => {
    const x = await queued('w1@x.test');
    expect(await workOnce('w-a')).toBe(true);
    const st = await jobStatus(x.u, x.r.jobId);
    expect(st.status).toBe('succeeded'); expect(st.outputId).toBeTruthy();
    const { buf } = await readOutput(x.u, st.outputId!);
    const m = await sharp(buf).metadata();
    expect([m.width, m.height]).toEqual([Math.round(54 / 25.4 * 300), Math.round(34 / 25.4 * 300)]); // trim + bleed both sides
    expect(m.density).toBe(300);
    const b = await balance(x.ca);
    expect(b.settled).toBe(100000 - x.q.customerAmountPaise); expect(b.held).toBe(0);
    expect((await balance(x.va)).held).toBe(0);
  });
  it('free re-download: repeated reads change no ledger rows', async () => {
    const x = await queued('w2@x.test'); await workOnce('w-a');
    const out = (await jobStatus(x.u, x.r.jobId)).outputId!;
    const n0 = (await getPool().query('select count(*)::int n from ledger_entries')).rows[0].n;
    await readOutput(x.u, out); await readOutput(x.u, out);
    expect((await getPool().query('select count(*)::int n from ledger_entries')).rows[0].n).toBe(n0);
  });
  it('other users and tenants cannot download; expired outputs are refused', async () => {
    const x = await queued('w3@x.test'); await workOnce('w-a');
    const out = (await jobStatus(x.u, x.r.jobId)).outputId!;
    const other = await mkActor(T, 'w3b@x.test'); const T2 = await mkTenant('V2'); const foreign = await mkActor(T2, 'w3c@x.test');
    for (const a of [other, foreign]) await expect(readOutput(a, out)).rejects.toMatchObject({ code: 'not_found' });
    await expect(jobStatus(other, x.r.jobId)).rejects.toMatchObject({ code: 'not_found' });
    await getPool().query("update outputs set expires_at=now()-interval '1 second' where id=$1", [out]);
    await expect(readOutput(x.u, out)).rejects.toMatchObject({ code: 'expired' });
  });
  it('detects a tampered stored file via checksum', async () => {
    const x = await queued('w4@x.test'); await workOnce('w-a');
    const out = (await jobStatus(x.u, x.r.jobId)).outputId!;
    await getPool().query("update outputs set sha256='deadbeef' where id=$1", [out]);
    await expect(readOutput(x.u, out)).rejects.toMatchObject({ code: 'integrity_failed' });
  });
  it('uses the quote snapshot, not later project edits', async () => {
    const x = await queued('w5@x.test');
    await saveProject(x.u, x.pid, 2, { settings: { ...S, widthMm: 100 } });
    await workOnce('w-a');
    const { buf } = await readOutput(x.u, (await jobStatus(x.u, x.r.jobId)).outputId!);
    expect((await sharp(buf).metadata()).width).toBe(Math.round(54 / 25.4 * 300));
  });
});

describe('leases, concurrency, recovery', () => {
  it('two workers claiming at once never share a job', async () => {
    for (let i = 0; i < 4; i++) await queued(`lc${i}@x.test`);
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => claimJob(`w${i}`)));
    const ids = claims.filter(Boolean).map(c => c!.jobId);
    expect(ids.length).toBeGreaterThanOrEqual(4); expect(new Set(ids).size).toBe(ids.length);
    for (const c of claims) if (c) await runJob(c.jobId, 'w' + claims.indexOf(c), c.attempt).catch(() => {});
  });
  it('worker dies mid-job: lease expires, job requeued, second worker completes, credit consumed once', async () => {
    const x = await queued('crash@x.test');
    const c = await claimJob('dead-worker', 60);
    await getPool().query("update jobs set lease_expires_at=now()-interval '1 second' where id=$1", [c!.jobId]);
    expect(await reapExpired()).toMatchObject({ requeued: 1 });
    expect((await balance(x.ca)).held).toBe(x.q.customerAmountPaise); // hold survives requeue
    await workOnce('w-b');
    expect((await jobStatus(x.u, x.r.jobId)).status).toBe('succeeded');
    expect((await balance(x.ca)).settled).toBe(100000 - x.q.customerAmountPaise);
    const att = await getPool().query('select outcome from job_attempts where job_id=$1 order by attempt_no', [x.r.jobId]);
    expect(att.rows.map(r => r.outcome)).toEqual(['lease_expired', 'succeeded']);
  });
  it('a zombie worker that lost its lease cannot finalize or double-charge', async () => {
    const x = await queued('zombie@x.test');
    const c = await claimJob('zombie', 60);
    let reaped = false;
    const done = await runJob(c!.jobId, 'zombie', c!.attempt, { beforeFinalize: async () => {
      await getPool().query("update jobs set lease_expires_at=now()-interval '1 second' where id=$1", [c!.jobId]); await reapExpired(); reaped = true;
      const c2 = await claimJob('fresh'); await runJob(c2!.jobId, 'fresh', c2!.attempt);
    } });
    expect(reaped).toBe(true); expect(done).toBe(false);
    expect((await jobStatus(x.u, x.r.jobId)).status).toBe('succeeded');
    expect((await getPool().query('select count(*)::int n from outputs where job_id=$1', [x.r.jobId])).rows[0].n).toBe(1);
    expect((await balance(x.ca)).settled).toBe(100000 - x.q.customerAmountPaise);
  });
  it('exhausted attempts fail the job and release the hold', async () => {
    const x = await queued('exh@x.test');
    for (let i = 0; i < 3; i++) { const c = await claimJob('w'); await getPool().query("update jobs set lease_expires_at=now()-interval '1 second' where id=$1", [c!.jobId]); await reapExpired(); }
    expect((await jobStatus(x.u, x.r.jobId)).status).toBe('failed');
    expect((await balance(x.ca))).toMatchObject({ settled: 100000, held: 0 });
  });
  it('engine failure releases hold, charges nothing, tells the customer', async () => {
    const x = await queued('bad@x.test');
    await getPool().query("update stored_files set storage_key='missing/nothing.png' where id=(select source_file_id from quotes where id=$1)", [x.q.quoteId]);
    await workOnce('w-a');
    const st = await jobStatus(x.u, x.r.jobId);
    expect(st.status).toBe('failed'); expect(st.message).toContain('not been charged');
    expect(await balance(x.ca)).toMatchObject({ settled: 100000, held: 0 });
  });
  it('cancellation requested during run resolves to cancelled with release', async () => {
    const x = await queued('cr@x.test'); const c = await claimJob('w');
    expect((await cancelBeforeDispatch(x.u, x.r.jobId)).status).toBe('cancellation_requested');
    await getPool().query("update stored_files set storage_key='missing/x.png' where id=(select source_file_id from quotes where id=$1)", [x.q.quoteId]);
    await runJob(c!.jobId, 'w', c!.attempt);
    expect((await jobStatus(x.u, x.r.jobId)).status).toBe('cancelled');
    expect((await balance(x.ca)).held).toBe(0);
  });
});

describe('heartbeat keeps a long render from being reaped', () => {
  it('a job running longer than its lease is not requeued while the heartbeat runs', async () => {
    const { claimJob, runJob, reapExpired } = await import('../src/server/worker');
    const { u } = await (async () => { const u = await mkActor(T, 'hb@x.test'); return { u }; })();
    const p = await createProject(u, 'hb'); const f = await saveOriginal(u, await png());
    await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S });
    await fund(T, u.userId, 100000, 'hb-c'); await fund(T, null, 1_000_000, 'hb-v');
    const q = await createQuote(u, p.id); await reserveQuote(u, q.quoteId);
    const c = (await claimJob('hb-w', 1))!;
    let reaped: { requeued: number; failed: number } | undefined;
    const ok = await runJob(c.jobId, 'hb-w', c.attempt, { heartbeatMs: 200, beforeFinalize: async () => { await new Promise(r => setTimeout(r, 1800)); reaped = await reapExpired(); } });
    expect(reaped).toEqual({ requeued: 0, failed: 0 });
    expect(ok).toBeTruthy();
  });
});
