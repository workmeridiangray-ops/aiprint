import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { workOnce, jobStatus, readOutput } from '../src/server/worker';
import { runRetention, listLibrary, requestDeletion, placeHold, releaseHold, libraryState, myTransactions, recordRun, lastRuns } from '../src/server/retention';
import { getPool } from '../src/server/db';

let T: string, PT: string;
beforeAll(async () => { await setupDb(); T = await mkTenant('V'); PT = await mkTenant('Platform', 'platform'); });
afterAll(closePool);
const S = { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' as const };
const png = () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6' } }).png().toBuffer();
async function made(email: string) {
  const u = await mkActor(T, email); const p = await createProject(u, 'Poster ' + email);
  const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S });
  await fund(T, u.userId, 100000, 'c-' + email); await fund(T, null, 1_000_000, 'v-' + email);
  const q = await createQuote(u, p.id); const r = await reserveQuote(u, q.quoteId);
  while (await workOnce('w')) { /* drain */ }
  const out = (await jobStatus(u, r.jobId)).outputId!;
  return { u, out, pid: p.id };
}
const key = async (out: string) => (await getPool().query('select f.storage_key k from outputs o join stored_files f on f.id=o.file_id where o.id=$1', [out])).rows[0].k as string;
const onDisk = async (out: string) => existsSync(path.join(process.env.STORAGE_LOCAL_DIR!, await key(out)));
const setExp = (out: string, sql: string) => getPool().query(`update outputs set expires_at=${sql} where id=$1`, [out]);
const staff = () => mkActor(PT, 'staff' + Math.random() + '@x.test', 'platform_owner');

describe('library', () => {
  it('lists own outputs only, with state and days left', async () => {
    const a = await made('l1@x.test'); const b = await made('l2@x.test');
    const la = await listLibrary(a.u);
    expect(la.map(x => x.id)).toEqual([a.out]);
    expect(la[0].state).toBe('available'); expect(la[0].daysLeft).toBeGreaterThan(85);
    expect((await listLibrary(b.u)).map(x => x.id)).toEqual([b.out]);
  });
  it('state boundaries: 8 days available, 7 days expiring, past expired', () => {
    const now = new Date('2026-01-01T00:00:00Z'); const d = (n: number) => new Date(now.getTime() + n * 86400000);
    expect(libraryState({ expires_at: d(8), revoked_at: null, purged_at: null }, now).state).toBe('available');
    expect(libraryState({ expires_at: d(7), revoked_at: null, purged_at: null }, now).state).toBe('expiring');
    expect(libraryState({ expires_at: d(-1), revoked_at: null, purged_at: null }, now).state).toBe('expired');
    expect(libraryState({ expires_at: d(30), revoked_at: now, purged_at: null }, now).state).toBe('removed');
  });
});

describe('warning', () => {
  it('queues exactly one 7-day warning, even when rerun', async () => {
    const x = await made('w1@x.test'); await setExp(x.out, "now()+interval '6 days'");
    const r1 = await runRetention(); const r2 = await runRetention();
    expect(r1.warned).toBe(1); expect(r2.warned).toBe(0);
    const n = (await getPool().query("select count(*)::int n from email_outbox where template='retention_warning' and to_email='w1@x.test'")).rows[0].n;
    expect(n).toBe(1);
  });
  it('does not warn for files far from expiry', async () => {
    const x = await made('w2@x.test'); await runRetention();
    expect((await getPool().query("select count(*)::int n from email_outbox where to_email='w2@x.test'")).rows[0].n).toBe(0);
    expect(x.out).toBeTruthy();
  });
});

describe('purge', () => {
  it('deletes the live copy after expiry, keeps metadata and financial history, and is safe to rerun', async () => {
    const x = await made('p1@x.test'); expect(await onDisk(x.out)).toBe(true);
    const led = (await getPool().query('select count(*)::int n from ledger_entries')).rows[0].n;
    await setExp(x.out, "now()-interval '1 minute'");
    expect((await runRetention()).purged).toBeGreaterThanOrEqual(1);
    expect(await onDisk(x.out)).toBe(false);
    expect((await getPool().query('select purged_at from outputs where id=$1', [x.out])).rows[0].purged_at).not.toBeNull();
    expect((await getPool().query('select count(*)::int n from ledger_entries')).rows[0].n).toBe(led);
    await expect(runRetention()).resolves.toMatchObject({ purged: 0 });
    await expect(readOutput(x.u, x.out)).rejects.toMatchObject({ code: 'removed' });
    expect((await listLibrary(x.u))[0].state).toBe('removed');
  });
  it('finishes a purge whose file is already gone (crash recovery)', async () => {
    const x = await made('p2@x.test'); const { deleteStored } = await import('../src/server/files');
    await deleteStored(await key(x.out)); await setExp(x.out, "now()-interval '1 minute'");
    expect((await runRetention()).failed).toBe(0);
    expect((await getPool().query('select purged_at from outputs where id=$1', [x.out])).rows[0].purged_at).not.toBeNull();
  });
  it('a failed deletion is recorded, not hidden, and retried next run', async () => {
    const x = await made('p3@x.test'); await setExp(x.out, "now()-interval '1 minute'");
    const k = await key(x.out); await getPool().query('update stored_files set storage_key=$2 where id=(select file_id from outputs where id=$1)', [x.out, '../../etc']);
    const r = await runRetention(); expect(r.failed).toBeGreaterThanOrEqual(1);
    const row = (await getPool().query('select purged_at, purge_error, purge_attempts from outputs where id=$1', [x.out])).rows[0];
    expect(row.purged_at).toBeNull(); expect(row.purge_attempts).toBeGreaterThan(0);
    await getPool().query('update stored_files set storage_key=$2 where id=(select file_id from outputs where id=$1)', [x.out, k]);
    await runRetention(); expect(await onDisk(x.out)).toBe(false);
  });
});

describe('customer deletion request', () => {
  it('stops downloads immediately and the next run purges; others cannot request it', async () => {
    const x = await made('d1@x.test'); const other = await mkActor(T, 'd1b@x.test');
    await expect(requestDeletion(other, x.out)).rejects.toMatchObject({ code: 'not_found' });
    await requestDeletion(x.u, x.out);
    await expect(readOutput(x.u, x.out)).rejects.toMatchObject({ code: 'removed' });
    expect(await onDisk(x.out)).toBe(true);
    await runRetention(); expect(await onDisk(x.out)).toBe(false);
  });
});

describe('holds', () => {
  it('a hold blocks purge until released; staff only; reason required; audited', async () => {
    const x = await made('h1@x.test'); const s = await staff();
    await expect(placeHold(x.u, x.out, 'because')).rejects.toMatchObject({ code: 'denied' });
    await expect(placeHold(s, x.out, 'x')).rejects.toMatchObject({ code: 'reason_required' });
    await placeHold(s, x.out, 'Open investigation 42');
    await setExp(x.out, "now()-interval '1 minute'"); await requestDeletion(x.u, x.out);
    const r = await runRetention(); expect(r.heldSkipped).toBeGreaterThanOrEqual(1);
    expect(await onDisk(x.out)).toBe(true);
    await releaseHold(s, x.out); await runRetention();
    expect(await onDisk(x.out)).toBe(false);
    const a = (await getPool().query("select action from audit_log where object_id=$1 order by id", [x.out])).rows.map(r => r.action);
    expect(a).toEqual(expect.arrayContaining(['retention.hold', 'retention.release', 'output.purged']));
  });
});

describe('statement and run record', () => {
  it('shows only own transactions with held/charged status', async () => {
    const x = await made('t1@x.test'); const y = await made('t2@x.test');
    const t = await myTransactions(x.u);
    expect(t.rows).toHaveLength(1); expect(t.rows[0].status).toBe('charged'); expect(t.rows[0].paidFrom).toBe('your credit');
    expect(t.personalCredit.settled).toBeLessThan(100000);
    expect((await myTransactions(y.u)).rows).toHaveLength(1);
  });
  it('records last run, failures, and restricts viewing to staff', async () => {
    await recordRun('retention', () => runRetention());
    await expect(recordRun('retention', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    const s = await staff(); const lr = await lastRuns(s);
    const row = lr.runs.find((r: any) => r.task === 'retention'); expect(row.ok).toBe(false); expect(row.error).toBe('boom');
    await expect(lastRuns(await mkActor(T, 'lr@x.test'))).rejects.toMatchObject({ code: 'denied' });
  });
});
