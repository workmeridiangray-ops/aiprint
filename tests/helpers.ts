import { execSync } from 'node:child_process';
import { getPool, closePool } from '../src/server/db';
import { createUser, login, resolveActor } from '../src/server/auth';
import { ensureAccount, postEntry } from '../src/server/ledger';

export const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://artwork:artwork_dev@localhost:5432/artwork_test';
export async function setupDb() {
  process.env.DATABASE_URL = TEST_URL; process.env.APP_ENV = 'test'; process.env.STORAGE_LOCAL_DIR = './.data/test-files';
  await closePool();
  const p = getPool();
  await p.query('drop schema public cascade; create schema public;');
  execSync('npx tsx scripts/migrate.ts', { env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: 'pipe' });
}
export async function mkTenant(name: string, kind = 'vendor') {
  return (await getPool().query('insert into tenants(kind,name) values($1,$2) returning id', [kind, name])).rows[0].id as string;
}
export async function mkActor(tenantId: string, email: string, role = 'customer') {
  await createUser(email, 'correct-horse-battery', tenantId, role);
  const { token } = await login(email, 'correct-horse-battery');
  return resolveActor(token, tenantId);
}
export async function fund(tenantId: string, ownerUserId: string | null, paise: number, key: string) {
  const acc = await ensureAccount(getPool(), tenantId, ownerUserId ? 'customer_service_credit' : 'vendor_processing_credit', ownerUserId);
  await postEntry(getPool(), acc, paise, 'test_seed', key);
  return acc;
}
export { closePool };
