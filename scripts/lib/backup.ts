import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { storage } from '../../src/server/storage';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const dbUrl = () => { const u = process.env.DATABASE_URL; if (!u) throw new Error('DATABASE_URL is not set'); return u; };

/** Fingerprint of the money and file records, compared before and after a restore. */
export async function fingerprint(c: pg.Client | pg.Pool) {
  const q = async (s: string) => (await c.query(s)).rows[0];
  return {
    ledgerEntries: Number((await q('select count(*) n from ledger_entries')).n),
    ledgerSumPaise: String((await q('select coalesce(sum(amount_paise),0) n from ledger_entries')).n),
    users: Number((await q('select count(*) n from users')).n),
    outputs: Number((await q('select count(*) n from outputs')).n),
    storedFilesLive: Number((await q('select count(*) n from stored_files where deleted_at is null')).n),
    jobs: Number((await q('select count(*) n from jobs')).n),
    reservationsHeld: Number((await q("select count(*) n from reservations where status='held'")).n),
  };
}

/** Order matters: database first, then files. A file written after the dump is an harmless orphan; a file deleted between the two shows up as missing and is reported, never hidden. */
export async function backup(dir: string) {
  if (existsSync(path.join(dir, 'MANIFEST.json'))) throw new Error('backup directory already holds a backup');
  mkdirSync(path.join(dir, 'files'), { recursive: true }); chmodSync(dir, 0o700);
  const dump = path.join(dir, 'db.dump');
  execFileSync('pg_dump', ['--format=custom', '--no-owner', '--file', dump, dbUrl()], { stdio: 'pipe' });
  const c = new pg.Client({ connectionString: dbUrl() }); await c.connect();
  try {
    const rows = (await c.query("select id, storage_key, sha256, bytes from stored_files where deleted_at is null order by created_at")).rows;
    const files: Array<{ key: string; sha256: string; bytes: number }> = []; const missing: string[] = [];
    for (const r of rows) {
      let buf: Buffer;
      try { buf = await storage().get(r.storage_key); } catch { missing.push(r.storage_key); continue; }
      if (sha(buf) !== r.sha256) { missing.push(r.storage_key + ' (checksum differs)'); continue; }
      const f = path.join(dir, 'files', r.storage_key); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, buf);
      files.push({ key: r.storage_key, sha256: r.sha256, bytes: buf.length });
    }
    const manifest = { createdAt: new Date().toISOString(), dumpSha256: sha(readFileSync(dump)), files, missingAtBackup: missing, fingerprint: await fingerprint(c), migrations: (await c.query('select name from schema_migrations order by name')).rows.map(r => r.name) };
    writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify(manifest, null, 1));
    return manifest;
  } finally { await c.end(); }
}

/** Restores into an EMPTY database and the storage configured in this process's environment. Refuses a non-empty target. */
export async function restore(dir: string, opts: { keepSessions?: boolean } = {}) {
  const m = JSON.parse(readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8'));
  if (sha(readFileSync(path.join(dir, 'db.dump'))) !== m.dumpSha256) throw new Error('database dump does not match its manifest checksum; backup is corrupt');
  // Short-lived connections: pg_restore runs as a child process and blocks this one, so no connection is held open across it.
  const probe = new pg.Client({ connectionString: dbUrl() }); await probe.connect();
  try {
    const t = await probe.query("select count(*)::int n from information_schema.tables where table_schema='public'");
    if (t.rows[0].n > 0) throw new Error('target database is not empty; restore refuses to overwrite');
  } finally { await probe.end(); }
  execFileSync('pg_restore', ['--no-owner', '--exit-on-error', '--dbname', dbUrl(), path.join(dir, 'db.dump')], { stdio: 'pipe' });
  const st = storage(); const bad: string[] = [];
  for (const f of m.files) {
    const buf = readFileSync(path.join(dir, 'files', f.key));
    if (sha(buf) !== f.sha256) { bad.push(f.key); continue; }
    await st.put(f.key, buf);
  }
  if (bad.length) throw new Error('backup files failed their checksum: ' + bad.join(', '));
  const c = new pg.Client({ connectionString: dbUrl() }); await c.connect();
  try {
    // Everyone signs in again: a session in the backup may belong to a user whose password, role or account changed afterwards.
    if (!opts.keepSessions) await c.query('delete from sessions');
    return await verify(c, m);
  } finally { await c.end(); }
}

/** Reconciles the restored database against the manifest and the restored storage. Returns problems; empty means consistent. */
export async function verify(c: pg.Client, m: any) {
  const problems: string[] = []; const st = storage();
  const fp = await fingerprint(c);
  for (const k of Object.keys(m.fingerprint) as Array<keyof typeof fp>) if (String(fp[k]) !== String(m.fingerprint[k])) problems.push(`${k}: restored ${fp[k]} but backup recorded ${m.fingerprint[k]}`);
  const rows = (await c.query("select storage_key, sha256 from stored_files where deleted_at is null")).rows;
  for (const r of rows) {
    try { const b = await st.get(r.storage_key); if (sha(b) !== r.sha256) problems.push('checksum mismatch: ' + r.storage_key); }
    catch { problems.push('file missing: ' + r.storage_key); }
  }
  const running = Number((await c.query("select count(*) n from jobs where status='running'")).rows[0].n);
  const held = Number((await c.query("select count(*) n from reservations r where status='held' and not exists (select 1 from jobs j where j.reservation_id=r.id and j.status in ('queued','running','cancellation_requested'))")).rows[0].n);
  if (held) problems.push(`${held} held reservation(s) have no active job (check by hand)`);
  return { problems, filesChecked: rows.length, fingerprint: fp, jobsRunningAtBackup: running, note: running ? 'Running jobs lost their worker; the reaper requeues them after the lease expires.' : '' };
}
