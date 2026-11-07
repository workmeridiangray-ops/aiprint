import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
const url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL required'); process.exit(1); }
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
for (const f of readdirSync('migrations').filter(f => f.endsWith('.sql')).sort()) {
  const done = await c.query('select 1 from schema_migrations where name=$1', [f]);
  if (done.rowCount) continue;
  await c.query('begin');
  try { await c.query(readFileSync(`migrations/${f}`, 'utf8')); await c.query('insert into schema_migrations(name) values($1)', [f]); await c.query('commit'); console.log('applied', f); }
  catch (e) { await c.query('rollback'); throw e; }
}
await c.end();
