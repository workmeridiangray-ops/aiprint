import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { workOnce, jobStatus, readOutput } from '../src/server/worker';
import { createPlan, activateSubscription, overview } from '../src/server/vendor';
import { storageState, assertStorageAvailable } from '../src/server/quota';
import { requestDeletion } from '../src/server/retention';
import { adminOverview } from '../src/server/admin';
import { getPool } from '../src/server/db';

let T: string, PT: string, owner: Awaited<ReturnType<typeof mkActor>>;
beforeAll(async () => { await setupDb(); PT = await mkTenant('Platform', 'platform'); T = await mkTenant('Quota Vendor'); owner = await mkActor(PT, 'qo@x.test', 'platform_owner'); });
afterAll(closePool);
const S = { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' as const };
const png = () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6' } }).png().toBuffer();
async function plan(storageMb: number | null, code: string) {
  const p = await createPlan(owner, { code, name: code, staffSeats: 3, monthlyPricePaise: 100000, storageMb });
  await activateSubscription(T, p.id, 'pay-' + code); return p;
}

describe('storage allowance', () => {
  it('is unlimited without a limit, and validated on plans', async () => {
    await plan(null, 'free-form');
    const u = await mkActor(T, 'u0@x.test');
    await saveOriginal(u, await png());
    expect((await storageState(getPool(), T)).quotaBytes).toBeNull();
    await expect(createPlan(owner, { code: 'bad', name: 'bad', staffSeats: 1, monthlyPricePaise: 0, storageMb: 0 })).rejects.toMatchObject({ code: 'invalid_plan' });
    await expect(createPlan(owner, { code: 'bad2', name: 'bad', staffSeats: 1, monthlyPricePaise: 0, storageMb: 1.5 })).rejects.toMatchObject({ code: 'invalid_plan' });
  });
  it('blocks a new upload that would exceed the allowance and a new reservation when full; counts purged files out', async () => {
    await plan(1, 'tiny'); // 1 MB
    const u = await mkActor(T, 'u1@x.test');
    const before = (await storageState(getPool(), T)).usedBytes;
    expect(before).toBeGreaterThan(0);
    const img = await png();
    await getPool().query("update stored_files set bytes=$2 where tenant_id=$1", [T, 1024 * 1024 - 10]); // nearly full
    await expect(saveOriginal(u, img)).rejects.toMatchObject({ code: 'storage_full', status: 409 });
    await getPool().query("update stored_files set deleted_at=now() where tenant_id=$1", [T]); // purged files do not count
    expect((await storageState(getPool(), T)).usedBytes).toBe(0);
    const f = await saveOriginal(u, img); expect(f.fileId).toBeTruthy();
  });
  it('full store: reserving new work is refused, but an already finished file can still be downloaded and deleted; nothing is removed', async () => {
    await plan(null, 'roomy');
    const u = await mkActor(T, 'u2@x.test'); const p = await createProject(u, 'P2');
    const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S });
    await fund(T, u.userId, 100000, 'q-c'); await fund(T, null, 1_000_000, 'q-v');
    const q1 = await createQuote(u, p.id); const r1 = await reserveQuote(u, q1.quoteId);
    while (await workOnce('w')) { /* drain */ }
    const out = (await jobStatus(u, r1.jobId)).outputId!;
    // downgrade to a tiny plan while holding more than it allows
    await plan(1, 'downgraded'); await getPool().query("update stored_files set bytes=2097152 where id=$1", [f.fileId]);
    const s = await storageState(getPool(), T); expect(s.over).toBe(true);
    const q2 = await createQuote(u, p.id);
    await expect(reserveQuote(u, q2.quoteId)).rejects.toMatchObject({ code: 'storage_full' });
    expect((await readOutput(u, out)).buf.length).toBeGreaterThan(0); // existing paid output still downloadable
    await requestDeletion(u, out); // and deletion still works
    const files = await getPool().query("select count(*)::int n from stored_files where tenant_id=$1 and deleted_at is null", [T]);
    expect(files.rows[0].n).toBeGreaterThan(0); // nothing was auto-removed to make room
  });
  it('shows usage to the vendor admin and to platform staff', async () => {
    const va = await mkActor(T, 'va@x.test', 'vendor_admin');
    const o = await overview(va); expect(o.storage.quotaBytes).toBe(1048576); expect(o.storage.over).toBe(true);
    const a = await adminOverview(owner); const t = a.tenants.find((x: any) => x.id === T)!;
    expect(t.storageQuotaBytes).toBe(1048576); expect(t.storageUsedBytes).toBeGreaterThanOrEqual(1048576);
    expect(a.plans.find((p: any) => p.code === 'tiny')!.storageMb).toBe(1);
  });
  it('assertStorageAvailable passes when under the allowance', async () => {
    await getPool().query("update stored_files set deleted_at=now() where tenant_id=$1", [T]);
    await expect(assertStorageAvailable(getPool(), T, 1000)).resolves.toBeTruthy();
  });
});
