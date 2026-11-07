import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject, getProject, validateSettings, outputPixels } from '../src/server/projects';
import { createQuote, reserveQuote, cancelBeforeDispatch } from '../src/server/quotes';
import { balance } from '../src/server/ledger';
import { getPool } from '../src/server/db';

let T: string;
beforeAll(async () => { await setupDb(); T = await mkTenant('Vendor'); });
afterAll(closePool);
const S = { widthMm: 210, heightMm: 297, bleedMm: 3, dpi: 300, fit: 'fill' as const };
const png = () => sharp({ create: { width: 200, height: 200, channels: 3, background: '#444' } }).png().toBuffer();
async function ready(email: string) {
  const u = await mkActor(T, email);
  const p = await createProject(u, 'P');
  const f = await saveOriginal(u, await png());
  await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S });
  return { u, pid: p.id };
}

describe('settings validation', () => {
  it('enforces 500 mm per side and 80 MP including bleed', () => {
    expect(() => validateSettings({ ...S, widthMm: 501 })).toThrow();
    expect(() => validateSettings({ ...S, widthMm: 500, heightMm: 500, dpi: 600 })).toThrow(/80 megapixels/);
    expect(outputPixels(validateSettings(S)).total).toBeLessThan(80e6);
  });
  it('bleed counts toward the ceiling', () => {
    const noBleed = { widthMm: 500, heightMm: 500, bleedMm: 0, dpi: 440, fit: 'fit' as const };
    expect(outputPixels({ ...noBleed, format: 'png' as const, offsetXMm: 0, offsetYMm: 0, rotationDeg: 0, scale: 1 }).total).toBeLessThan(80e6);
    expect(() => validateSettings({ ...noBleed, bleedMm: 20 })).toThrow(/80 megapixels/);
  });
});

describe('server-confirmed saves and revision conflicts', () => {
  it('increments revision and rejects a stale writer with the current state', async () => {
    const u = await mkActor(T, 'rev1@x.test'); const p = await createProject(u, 'R');
    const a = await saveProject(u, p.id, 1, { settings: S });
    expect(a.revision).toBe(2);
    await expect(saveProject(u, p.id, 1, { settings: { ...S, dpi: 150 } })).rejects.toMatchObject({ code: 'revision_conflict', current: { revision: 2 } });
    expect((await getProject(u, p.id)).settings.dpi).toBe(300);
  });
  it('two simultaneous saves from the same revision: exactly one wins', async () => {
    const u = await mkActor(T, 'rev2@x.test'); const p = await createProject(u, 'R');
    const r = await Promise.allSettled([saveProject(u, p.id, 1, { settings: S }), saveProject(u, p.id, 1, { settings: { ...S, dpi: 200 } })]);
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.filter(x => x.status === 'rejected')).toHaveLength(1);
  });
  it('invalid settings do not bump the revision', async () => {
    const u = await mkActor(T, 'rev3@x.test'); const p = await createProject(u, 'R');
    await expect(saveProject(u, p.id, 1, { settings: { ...S, widthMm: 9999 } })).rejects.toMatchObject({ code: 'invalid_settings' });
    expect((await getProject(u, p.id)).revision).toBe(1);
  });
});

describe('quote and reservation', () => {
  it('needs a source image', async () => {
    const u = await mkActor(T, 'q0@x.test'); const p = await createProject(u, 'x');
    await saveProject(u, p.id, 1, { settings: S });
    await expect(createQuote(u, p.id)).rejects.toMatchObject({ code: 'no_source' });
  });
  it('holds customer and vendor credit without spending it; shortage is refused with no side effects', async () => {
    const { u, pid } = await ready('q1@x.test');
    const q = await createQuote(u, pid);
    await expect(reserveQuote(u, q.quoteId)).rejects.toMatchObject({ code: 'insufficient_customer_credit' });
    expect((await getPool().query('select count(*)::int n from reservations')).rows[0].n).toBe(0);
    const ca = await fund(T, u.userId, 100000, 'c-q1'); const va = await fund(T, null, 100000, 'v-q1');
    const r = await reserveQuote(u, q.quoteId);
    expect(r.repeated).toBe(false);
    expect((await balance(ca)).available).toBe(100000 - q.customerAmountPaise);
    expect((await balance(ca)).settled).toBe(100000);
    expect((await balance(va)).held).toBe(q.vendorChargePaise);
  });
  it('is idempotent: reserving the same quote twice holds once', async () => {
    const { u, pid } = await ready('q2@x.test'); const ca = await fund(T, u.userId, 50000, 'c-q2');
    const q = await createQuote(u, pid);
    const a = await reserveQuote(u, q.quoteId), b = await reserveQuote(u, q.quoteId);
    expect(b).toMatchObject({ jobId: a.jobId, repeated: true });
    expect((await balance(ca)).held).toBe(q.customerAmountPaise);
  });
  it('refuses expired quotes', async () => {
    const { u, pid } = await ready('q3@x.test'); await fund(T, u.userId, 50000, 'c-q3');
    const q = await createQuote(u, pid);
    await getPool().query("update quotes set expires_at = now() - interval '1 second' where id=$1", [q.quoteId]);
    await expect(reserveQuote(u, q.quoteId)).rejects.toMatchObject({ code: 'quote_expired' });
  });
  it('refuses a stale quote after the artwork changed', async () => {
    const { u, pid } = await ready('q4@x.test'); await fund(T, u.userId, 50000, 'c-q4');
    const q = await createQuote(u, pid);
    await saveProject(u, pid, 2, { settings: { ...S, dpi: 150 } });
    await expect(reserveQuote(u, q.quoteId)).rejects.toMatchObject({ code: 'quote_stale' });
  });
  it("another user cannot reserve someone else's quote", async () => {
    const { u, pid } = await ready('q5@x.test'); const other = await mkActor(T, 'q5b@x.test'); await fund(T, other.userId, 50000, 'c-q5b');
    const q = await createQuote(u, pid);
    await expect(reserveQuote(other, q.quoteId)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('cancel before dispatch releases both holds; cancelling twice is an invalid transition', async () => {
    const { u, pid } = await ready('q6@x.test'); const ca = await fund(T, u.userId, 50000, 'c-q6');
    const q = await createQuote(u, pid); const r = await reserveQuote(u, q.quoteId);
    expect((await cancelBeforeDispatch(u, r.jobId)).status).toBe('cancelled');
    expect((await balance(ca)).held).toBe(0);
    await expect(cancelBeforeDispatch(u, r.jobId)).rejects.toMatchObject({ code: 'invalid_transition' });
  });
  it('a running job keeps its hold and cancellation is only a request', async () => {
    const { u, pid } = await ready('q7@x.test'); const ca = await fund(T, u.userId, 50000, 'c-q7');
    const q = await createQuote(u, pid); const r = await reserveQuote(u, q.quoteId);
    await getPool().query("update jobs set status='running' where id=$1", [r.jobId]);
    expect((await cancelBeforeDispatch(u, r.jobId)).status).toBe('cancellation_requested');
    expect((await balance(ca)).held).toBe(q.customerAmountPaise);
  });
});

describe('concurrency: credit cannot be overspent', () => {
  it('20 simultaneous reservations against credit for exactly 3 succeed 3 times', async () => {
    const u = await mkActor(T, 'conc@x.test'); const p = await createProject(u, 'C');
    const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S });
    const q0 = await createQuote(u, p.id);
    const ca = await fund(T, u.userId, q0.customerAmountPaise * 3, 'c-conc'); await fund(T, null, 10_000_000, 'v-conc');
    const quotes = await Promise.all(Array.from({ length: 20 }, () => createQuote(u, p.id)));
    const res = await Promise.allSettled(quotes.map(q => reserveQuote(u, q.quoteId)));
    expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(3);
    for (const r of res) if (r.status === 'rejected') expect(r.reason.code).toBe('insufficient_customer_credit');
    const b = await balance(ca); expect(b.available).toBe(0); expect(b.held).toBe(q0.customerAmountPaise * 3);
  });
  it('vendor processing credit is also protected under concurrency across customers', async () => {
    const T2 = await mkTenant('Vendor 2');
    const users = await Promise.all(['v1', 'v2', 'v3', 'v4', 'v5', 'v6'].map(n => mkActor(T2, `${n}@y.test`)));
    const quotes = [] as { u: typeof users[0]; id: string; vendor: number }[];
    for (const u of users) {
      const p = await createProject(u, 'V'); const f = await saveOriginal(u, await png());
      await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S }); await fund(T2, u.userId, 1_000_000, `c-${u.userId}`);
      const q = await createQuote(u, p.id); quotes.push({ u, id: q.quoteId, vendor: q.vendorChargePaise });
    }
    const va = await fund(T2, null, quotes[0].vendor * 2, 'v-two');
    const res = await Promise.allSettled(quotes.map(q => reserveQuote(q.u, q.id)));
    expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(2);
    expect((await balance(va)).available).toBe(0);
  });
});

describe('ledger integrity', () => {
  it('entries are append-only and idempotent by key', async () => {
    const u = await mkActor(T, 'led@x.test');
    const acc = await fund(T, u.userId, 500, 'k1'); await fund(T, u.userId, 500, 'k1');
    expect((await balance(acc)).settled).toBe(500);
    await expect(getPool().query('update ledger_entries set amount_paise=1')).rejects.toThrow(/append-only/);
    await expect(getPool().query('delete from ledger_entries')).rejects.toThrow(/append-only/);
  });
});
