// Creates the FIRST platform owner on a fresh deployment. Reads OWNER_EMAIL and OWNER_PASSWORD from the environment (never from arguments, so the password stays out of shell history and process lists).
// Refuses if a platform owner already exists. The owner must enrol two-step sign-in at first login (required for this role by default).
import { createUser } from '../src/server/auth';
import { getPool, closePool } from '../src/server/db';
const email = process.env.OWNER_EMAIL?.trim(), password = process.env.OWNER_PASSWORD;
try {
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('OWNER_EMAIL must be a valid email address');
  if (!password || password.length < 12) throw new Error('OWNER_PASSWORD must be at least 12 characters');
  const p = getPool();
  const have = await p.query("select 1 from memberships where role='platform_owner' and revoked_at is null limit 1");
  if (have.rowCount) throw new Error('a platform owner already exists; use the app to manage staff');
  const t = (await p.query("select id from tenants where kind='platform' limit 1")).rows[0]?.id
    ?? (await p.query("insert into tenants(kind,name) values('platform','Platform') returning id")).rows[0].id;
  await createUser(email, password, t, 'platform_owner');
  await p.query("insert into audit_log(action,object_type,outcome) values('platform.owner_created','user','ok')");
  console.log('platform owner created. Sign in and set up two-step sign-in when prompted.');
  process.exitCode = 0;
} catch (e: any) { console.error('create-owner FAILED:', e.message); process.exitCode = 1; }
finally { await closePool(); }
