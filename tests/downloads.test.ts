import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote, expireUndispatchedHolds } from '../src/server/quotes';
import { workOnce, jobStatus } from '../src/server/worker';
import { signLink, verifyLink, issueDownloadLink, LINK_TTL_SECONDS } from '../src/server/downloadlink';
import { requestDeletion } from '../src/server/retention';
import { balance } from '../src/server/ledger';
import { getPool } from '../src/server/db';

let T: string;
beforeAll(async () => { await setupDb(); T = await mkTenant('V'); });
afterAll(closePool);
const S = { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' as const };
const png = () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6' } }).png().toBuffer();
async function reserved(email: string) {
  const u = await mkActor(T, email); const p = await createProject(u, 'P ' + email);
  const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S });
  await fund(T, u.userId, 100000, 'c-' + email); await fund(T, null, 1_000_000, 'v-' + email);
  const q = await createQuote(u, p.id); const r = await reserveQuote(u, q.quoteId);
  return { u, jobId: r.jobId };
}

describe('short-lived download links', () => {
  it('signs, verifies, and rejects tampering, wrong output, wrong user and expiry', () => {
    const now = 1_800_000_000_000; const { token } = signLink('out-1', 'user-1', now);
    expect(() => verifyLink(token, 'out-1', 'user-1', now + 1000)).not.toThrow();
    expect(() => verifyLink(token, 'out-2', 'user-1', now)).toThrow(/not valid/);
    expect(() => verifyLink(token, 'out-1', 'user-2', now)).toThrow(/not valid/);
    expect(() => verifyLink(token.slice(0, -2) + 'AA', 'out-1', 'user-1', now)).toThrow(/not valid/);
    expect(() => verifyLink(null, 'out-1', 'user-1', now)).toThrow(/not valid/);
    expect(() => verifyLink(token, 'out-1', 'user-1', now + (LINK_TTL_SECONDS + 1) * 1000)).toThrow(/expired/);
    expect(LINK_TTL_SECONDS).toBe(300);
  });
  it('issues a link to the owner only, and not for a deleted file', async () => {
    const a = await reserved('d1@x.test'); while (await workOnce('w')) { /* drain */ }
    const out = (await jobStatus(a.u, a.jobId)).outputId!;
    const l = await issueDownloadLink(a.u, out);
    expect(l.url).toContain(`/api/outputs/${out}/download?t=`);
    expect(new Date(l.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(300_000);
    const other = await mkActor(T, 'd2@x.test');
    await expect(issueDownloadLink(other, out)).rejects.toMatchObject({ status: 404 });
    await requestDeletion(a.u, out);
    await expect(issueDownloadLink(a.u, out)).rejects.toMatchObject({ status: 410 });
  });
});

describe('abandoned hold expiry', () => {
  it('releases only queued, never-attempted jobs older than the limit; running and fresh jobs keep their hold', async () => {
    const old = await reserved('h1@x.test'); const fresh = await reserved('h2@x.test'); const running = await reserved('h3@x.test');
    const pool = getPool();
    await pool.query("update jobs set created_at = now() - interval '45 minutes' where id=any($1)", [[old.jobId, running.jobId]]);
    await pool.query("update jobs set status='running', attempts=1 where id=$1", [running.jobId]);
    const held = async (jobId: string) => (await pool.query('select r.status from jobs j join reservations r on r.id=j.reservation_id where j.id=$1', [jobId])).rows[0].status;
    const before = await balance((await pool.query("select id from ledger_accounts where owner_user_id=$1 and kind='customer_service_credit'", [old.u.userId])).rows[0].id);
    expect(before.held).toBeGreaterThan(0);
    const r = await expireUndispatchedHolds(30);
    expect(r.released).toBe(1);
    expect(await held(old.jobId)).toBe('released'); expect(await held(fresh.jobId)).toBe('held'); expect(await held(running.jobId)).toBe('held');
    expect((await jobStatus(old.u, old.jobId)).message).toMatch(/did not start in time/);
    const after = await balance((await pool.query("select id from ledger_accounts where owner_user_id=$1 and kind='customer_service_credit'", [old.u.userId])).rows[0].id);
    expect(after.held).toBe(0); expect(after.settled).toBe(before.settled);
    expect((await expireUndispatchedHolds(30)).released).toBe(0); // idempotent
  });
  it('rejects a non-positive limit', async () => { await expect(expireUndispatchedHolds(0)).rejects.toThrow(/positive/); });
});
