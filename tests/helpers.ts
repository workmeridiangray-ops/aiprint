import { execSync } from 'node:child_process';
import { getPool, closePool } from '../src/server/db';
import { createUser, login, resolveActor } from '../src/server/auth';
import { ensureAccount, postEntry } from '../src/server/ledger';
import { activateSubscription } from '../src/server/vendor';

export const TEST_URL = process.env.TEST_DATABASE_URL ?? 'postgres://artwork:artwork_dev@localhost:5432/artwork_test';
export async function setupDb() {
  process.env.DATABASE_URL = TEST_URL; process.env.APP_ENV = 'test'; process.env.MFA_REQUIRED_ROLES = ''; process.env.STORAGE_LOCAL_DIR = './.data/test-files';
  await closePool();
  const p = getPool();
  await p.query('drop schema public cascade; create schema public;');
  execSync('npx tsx scripts/migrate.ts', { env: { ...process.env, DATABASE_URL: TEST_URL }, stdio: 'pipe' });
  await p.query('insert into platform_pricing(per_mp_paise,min_paise) values(100,200)'); // test fixture
  testPlanId = (await p.query("insert into plans(code,version,name,staff_seats,monthly_price_paise) values('test',1,'Test plan',10,100000) returning id")).rows[0].id;
}
export let testPlanId = '';
/** Tenant with no subscription and no prices. */
export async function mkBareTenant(name: string, kind = 'vendor', status = 'active') {
  return (await getPool().query('insert into tenants(kind,name,status) values($1,$2,$3) returning id', [kind, name, status])).rows[0].id as string;
}
/** Ready-to-use tenant: active, retail prices set; vendors also get an active subscription via the real activation path. */
export async function mkTenant(name: string, kind = 'vendor') {
  const id = await mkBareTenant(name, kind);
  await getPool().query('insert into vendor_pricing(tenant_id,per_mp_paise,min_paise) values($1,500,1000)', [id]);
  if (kind === 'vendor') { await getPool().query("insert into subscriptions(tenant_id,status) values($1,'pending')", [id]); await activateSubscription(id, testPlanId, 'test-pay-' + id); }
  return id;
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
