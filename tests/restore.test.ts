import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { execFileSync, execSync } from 'node:child_process';
import { rmSync, existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setupDb, mkTenant, mkActor, fund, closePool, TEST_URL } from './helpers';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { workOnce, jobStatus } from '../src/server/worker';
import { getPool } from '../src/server/db';

// Restore drill: real data -> backup -> destroy the live database and files -> restore into an empty database and empty storage -> reconcile -> sign in and download.
const RESTORE_URL = TEST_URL.replace(/artwork_test$/, 'artwork_restore_drill');
const RESTORE_FILES = path.resolve('./.data/restore-drill-files');
const run = (script: string, args: string[], env: Record<string, string>) =>
  execFileSync('npx', ['tsx', script, ...args], { env: { ...process.env, APP_ENV: 'test', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const admin = TEST_URL.replace(/artwork_test$/, 'postgres');
const resetTarget = () => { execSync(`psql "${admin}" -c "drop database if exists artwork_restore_drill" -c "create database artwork_restore_drill"`, { stdio: 'pipe' }); rmSync(RESTORE_FILES, { recursive: true, force: true }); };

let T: string, dir: string, email = 'drill@x.test', outId: string, expectedSha: string;
beforeAll(async () => {
  await setupDb(); T = await mkTenant('Drill Vendor');
  const u = await mkActor(T, email); const p = await createProject(u, 'Drill');
  const f = await saveOriginal(u, await sharp({ create: { width: 400, height: 300, channels: 3, background: '#2a6' } }).png().toBuffer());
  await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' } });
  await fund(T, u.userId, 100000, 'drill-c'); await fund(T, null, 1_000_000, 'drill-v');
  const r = await reserveQuote(u, (await createQuote(u, p.id)).quoteId);
  while (await workOnce('w')) { /* drain */ }
  outId = (await jobStatus(u, r.jobId)).outputId!;
  expectedSha = (await getPool().query('select sha256 from outputs where id=$1', [outId])).rows[0].sha256;
  dir = mkdtempSync(path.join(tmpdir(), 'backup-')); rmSync(dir, { recursive: true });
});
afterAll(async () => { await closePool(); rmSync(dir, { recursive: true, force: true }); rmSync(RESTORE_FILES, { recursive: true, force: true }); });
const live = { DATABASE_URL: TEST_URL, STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: './.data/test-files' };
const target = { DATABASE_URL: RESTORE_URL, STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: RESTORE_FILES };

describe('backup and restore drill', () => {
  it('backs up, restores into an empty environment, reconciles, and the customer can sign in and download the same file', async () => {
    expect(run('scripts/backup.ts', [dir], live)).toMatch(/backup OK: 2 files, 0 missing/);
    resetTarget();
    const out = run('scripts/restore.ts', [dir], target);
    expect(out).toMatch(/consistent with the backup manifest/);
    expect(Number((await getPool().query('select count(*) n from sessions')).rows[0].n)).toBeGreaterThan(0); // the live system had sessions
    expect(execSync(`psql "${RESTORE_URL}" -tAc "select count(*) from sessions"`, { encoding: 'utf8' }).trim()).toBe('0'); // restore signed everyone out
    expect(run('tests/restored-download.mts', [email, 'correct-horse-battery', T, outId], target).trim()).toBe(expectedSha);
  });
  it('refuses to restore over a non-empty database', () => {
    expect(() => run('scripts/restore.ts', [dir], target)).toThrow(/not empty/);
  });
  it('detects a corrupt backup file and a corrupt dump', () => {
    const m = JSON.parse(readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8')); const f = path.join(dir, 'files', m.files[0].key);
    const orig = readFileSync(f); writeFileSync(f, Buffer.concat([orig, Buffer.from('x')])); resetTarget();
    expect(() => run('scripts/restore.ts', [dir], target)).toThrow(/checksum/); writeFileSync(f, orig);
    const dump = path.join(dir, 'db.dump'); const d = readFileSync(dump); writeFileSync(dump, Buffer.concat([d, Buffer.from('x')])); resetTarget();
    expect(() => run('scripts/restore.ts', [dir], target)).toThrow(/does not match its manifest/); writeFileSync(dump, d);
  });
  it('reports a file that has gone missing after restore (reconciliation does not hide it)', async () => {
    resetTarget(); run('scripts/restore.ts', [dir], target);
    const m = JSON.parse(readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8'));
    const { verify } = await import('../scripts/lib/backup'); const pg = (await import('pg')).default;
    const c = new pg.Client({ connectionString: RESTORE_URL }); await c.connect();
    const prev = process.env.STORAGE_LOCAL_DIR; process.env.STORAGE_LOCAL_DIR = RESTORE_FILES;
    try {
      expect((await verify(c, m)).problems).toEqual([]);
      rmSync(path.join(RESTORE_FILES, m.files[0].key));
      expect((await verify(c, m)).problems.join(' ')).toMatch(/file missing/);
      await c.query("insert into ledger_entries(account_id,amount_paise,reason,idempotency_key) select id, 5, 'tamper', 'tamper-1' from ledger_accounts limit 1");
      await expect(c.query('delete from ledger_entries')).rejects.toThrow(/append-only/); // restored DB still enforces append-only
      expect((await verify(c, m)).problems.join(' ')).toMatch(/ledgerEntries/);
    } finally { process.env.STORAGE_LOCAL_DIR = prev; await c.end(); }
  });
  it('backup refuses a directory that already holds a backup and fails loudly when a live file is missing', async () => {
    expect(() => run('scripts/backup.ts', [dir], live)).toThrow(/already holds a backup/);
    const key = (await getPool().query("select storage_key k from stored_files where kind='original' limit 1")).rows[0].k as string;
    const f = path.resolve('./.data/test-files', key); const keep = readFileSync(f); rmSync(f);
    const d2 = mkdtempSync(path.join(tmpdir(), 'backup2-')); rmSync(d2, { recursive: true });
    try { expect(() => run('scripts/backup.ts', [d2], live)).toThrow(); } finally { writeFileSync(f, keep); rmSync(d2, { recursive: true, force: true }); }
  });
});
