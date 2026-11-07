import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import S3rver from 's3rver';
import sharp from 'sharp';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import { storage, checkStorage, checkKey, StorageMissing } from '../src/server/storage';
import { saveOriginal, readOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { workOnce, jobStatus, readOutput } from '../src/server/worker';
import { runRetention, requestDeletion } from '../src/server/retention';
import { getPool } from '../src/server/db';

const KEYS = ['STORAGE_DRIVER', 'STORAGE_LOCAL_DIR', 'S3_BUCKET', 'S3_REGION', 'S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_FORCE_PATH_STYLE', 'APP_ENV'] as const;
let saved: Record<string, string | undefined> = {}; let server: any; const PORT = 4571;
beforeAll(async () => {
  await setupDb(); saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  server = new S3rver({ port: PORT, address: '127.0.0.1', silent: true, directory: mkdtempSync(path.join(tmpdir(), 's3-')), configureBuckets: [{ name: 'artwork-test', configs: [] }] }); await server.run();
});
afterAll(async () => { await server.close(); await closePool(); });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
const useS3 = () => Object.assign(process.env, { STORAGE_DRIVER: 's3', S3_BUCKET: 'artwork-test', S3_REGION: 'us-east-1', S3_ENDPOINT: `http://127.0.0.1:${PORT}`, S3_FORCE_PATH_STYLE: 'true', S3_ACCESS_KEY_ID: 'S3RVER', S3_SECRET_ACCESS_KEY: 'S3RVER', APP_ENV: 'test' });

describe('keys', () => {
  it('rejects traversal and odd keys', () => {
    for (const k of ['../x', 'a/../b', '/abs', 'a//b', 'a/./b', '', 'sp ace', 'a\\b']) expect(() => checkKey(k), k).toThrow();
    expect(checkKey('tenant-1/exports/abc.png')).toBe('tenant-1/exports/abc.png');
  });
});

describe('fails closed', () => {
  it('production and staging never use local disk; bad S3 settings are refused', () => {
    for (const env of ['production', 'staging']) { process.env.APP_ENV = env; process.env.STORAGE_DRIVER = 'local'; expect(() => storage()).toThrow(/not configured/); delete process.env.STORAGE_DRIVER; expect(() => storage()).toThrow(/not configured/); }
    process.env.APP_ENV = 'production'; process.env.STORAGE_DRIVER = 's3'; delete process.env.S3_BUCKET; expect(() => storage()).toThrow(/S3_BUCKET/);
    process.env.S3_BUCKET = 'b'; process.env.S3_ENDPOINT = 'http://insecure.example'; expect(() => storage()).toThrow(/https/);
    process.env.STORAGE_DRIVER = 'ftp'; expect(() => storage()).toThrow(/Unknown STORAGE_DRIVER/);
  });
});

describe.each([['local'], ['s3']])('driver contract: %s', name => {
  const setup = () => { if (name === 's3') useS3(); else { process.env.STORAGE_DRIVER = 'local'; process.env.STORAGE_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), 'loc-')); process.env.APP_ENV = 'test'; } };
  it('puts, gets, removes, and treats a missing object as missing', async () => {
    setup(); const s = storage(); expect(s.kind).toBe(name); const key = `t/${Date.now()}-${name}.bin`; const data = Buffer.from([0, 1, 2, 250, 255]);
    await s.put(key, data); expect((await s.get(key)).equals(data)).toBe(true);
    await s.remove(key); await expect(s.get(key)).rejects.toBeInstanceOf(StorageMissing);
    await expect(s.remove(key)).resolves.toBeUndefined(); // deleting twice is fine
    await expect(s.get('t/never-existed.bin')).rejects.toBeInstanceOf(StorageMissing);
    await expect(s.put('../escape', data)).rejects.toThrow(/invalid storage key/);
  });
  it('probe passes (the go-live check)', async () => { setup(); await expect(checkStorage()).resolves.toEqual({ driver: name }); });
});

describe('the real pipeline on S3', () => {
  it('upload, job, download, deletion request and purge all go through the bucket', async () => {
    useS3(); const T = await mkTenant('S3V'); const u = await mkActor(T, 's3u@x.test');
    const p = await createProject(u, 'On S3'); const buf = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#0a8' } }).png().toBuffer();
    const f = await saveOriginal(u, buf); expect((await readOriginal(u, f.fileId)).equals(buf)).toBe(true);
    await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' } });
    await fund(T, u.userId, 100000, 's3c'); await fund(T, null, 1_000_000, 's3v');
    const r = await reserveQuote(u, (await createQuote(u, p.id)).quoteId); while (await workOnce('w')) { /* drain */ }
    const outId = (await jobStatus(u, r.jobId)).outputId!; const dl = await readOutput(u, outId); expect(dl.buf.length).toBeGreaterThan(1000);
    const key = (await getPool().query('select f.storage_key k from outputs o join stored_files f on f.id=o.file_id where o.id=$1', [outId])).rows[0].k;
    expect((await storage().get(key)).length).toBe(dl.buf.length);
    await requestDeletion(u, outId); expect((await runRetention()).purged).toBeGreaterThanOrEqual(1);
    await expect(storage().get(key)).rejects.toBeInstanceOf(StorageMissing); // really gone from the bucket
    // an object missing behind the database's back is reported, not served or hidden
    const f2 = await saveOriginal(u, buf); await storage().remove((await getPool().query('select storage_key k from stored_files where id=$1', [f2.fileId])).rows[0].k);
    await expect(readOriginal(u, f2.fileId)).rejects.toMatchObject({ code: 'file_missing' });
  });
});
