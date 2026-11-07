// One command for every real-browser check: npm run e2e
// Builds a fresh e2e database (artwork_e2e), seeds it, starts the app + worker, runs each Playwright script, then re-starts the app with
// the default two-step rules for the MFA script. A script fails if it throws (selector timeouts, page errors it checks, bad status).
// Needs Postgres running, Chromium + playwright installed, and a built app (`npm run build`) unless E2E_BUILD=1 is set.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import sharp from 'sharp';

const PORT = '3113', ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'postgres://artwork:artwork_dev@localhost:5432/postgres';
const DB = ADMIN_URL.replace(/\/[^/]*$/, '/artwork_e2e');
const env = { ...process.env, DATABASE_URL: DB, APP_ENV: 'test', STORAGE_LOCAL_DIR: './.data/e2e-files', PORT };
const out = process.env.E2E_OUT ?? './.data/e2e-out'; fs.mkdirSync(out, { recursive: true });
const run = (cmd: string, args: string[], e: NodeJS.ProcessEnv = env, quiet = true) => spawnSync(cmd, args, { env: e, stdio: quiet ? 'pipe' : 'inherit', encoding: 'utf8' });
const sh = (cmd: string, args: string[], e?: NodeJS.ProcessEnv) => { const r = run(cmd, args, e); if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stdout}${r.stderr}`); return r; };
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const kids: ChildProcess[] = []; const bg = (cmd: string, args: string[], e: NodeJS.ProcessEnv) => { const c = spawn(cmd, args, { env: e, stdio: 'ignore' }); kids.push(c); return c; };
async function waitUp() { for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/login`)).ok) return; } catch {} await sleep(1000); } throw new Error('app did not start'); }
const stopAll = () => { for (const k of kids.splice(0)) k.kill('SIGTERM'); };
process.on('exit', stopAll);

(async () => {
  const sample = `${out}/sample.png`; await sharp({ create: { width: 900, height: 600, channels: 3, background: '#d33' } }).png().toFile(sample);
  sh('psql', [ADMIN_URL, '-c', 'drop database if exists artwork_e2e']); sh('psql', [ADMIN_URL, '-c', 'create database artwork_e2e owner artwork']);
  fs.rmSync('./.data/e2e-files', { recursive: true, force: true });
  sh('npx', ['tsx', 'scripts/migrate.ts']); sh('npx', ['tsx', 'scripts/seed-dev.ts']); sh('npx', ['tsx', 'tests/e2e/mkplatform.mts']);
  if (process.env.E2E_BUILD === '1' || !fs.existsSync('.next/BUILD_ID')) sh('npx', ['next', 'build']);
  const results: [string, boolean, string][] = [];
  const phase = async (mfaRoles: string, scripts: [string, string[]][]) => {
    const e = { ...env, MFA_REQUIRED_ROLES: mfaRoles }; if (mfaRoles === '') e.MFA_REQUIRED_ROLES = '';
    const app = bg('npx', ['next', 'start', '-p', PORT], e); const worker = bg('npx', ['tsx', 'scripts/worker.ts'], e); await waitUp();
    for (const [name, args] of scripts) { const r = run('node', [`tests/e2e/${name}.cjs`, ...args], e); const ok = r.status === 0; results.push([name, ok, ok ? '' : (r.stdout + r.stderr).split('\n').slice(-12).join('\n')]); console.log(ok ? 'PASS' : 'FAIL', name); }
    app.kill('SIGTERM'); worker.kill('SIGTERM'); await sleep(1500);
  };
  const S = (n: string) => `${out}/${n}.png`;
  await phase('', [['public-site-flow', []], ['editor-flow', [sample]], ['editor-drag', [sample]], ['cmyk-flow', [sample, out]], ['library-flow', [S('library')]], ['vendor-counter-flow', [sample]],
    ['claims-flow', [sample, out]], ['business-flow', []], ['audit-customers-flow', [S('audit')]], ['admin-flow', [S('admin')]], ['support-flow', [S('support')]]]);
  await phase('platform_owner,platform_support', [['mfa-flow', [S('mfa')]]]);
  stopAll();
  const bad = results.filter(r => !r[1]); console.log(`\n${results.length - bad.length}/${results.length} browser scripts passed`);
  for (const [n, , tail] of bad) console.log(`\n--- ${n} ---\n${tail}`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e.message); stopAll(); process.exit(2); });
