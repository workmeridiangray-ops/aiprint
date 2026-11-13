// EXPLICIT DEVELOPMENT SEED ONLY. Refuses to run in production/staging. Creates fictional sample records.
import { createUser } from '../src/server/auth';
import { ensureAccount, postEntry } from '../src/server/ledger';
import { activateSubscription } from '../src/server/vendor';
import { closePool, getPool } from '../src/server/db';
if (['production', 'staging'].includes(process.env.APP_ENV ?? '')) { console.error('Refusing to seed in ' + process.env.APP_ENV); process.exit(1); }
const p = getPool(); const pw = process.env.SEED_PASSWORD || 'dev-password-12345';
if ((await p.query("select 1 from vendor_profiles where slug='dev-sample'")).rowCount) { console.log('Dev seed already present.'); await closePool(); process.exit(0); }
if (!(await p.query('select 1 from platform_pricing')).rowCount) await p.query('insert into platform_pricing(per_mp_paise,min_paise) values(100,200)');
const plan = (await p.query("insert into plans(code,version,name,staff_seats,monthly_price_paise) values('dev',(select coalesce(max(version),0)+1 from plans where code='dev'),'Dev plan',5,100000) returning id")).rows[0].id;
const t = (await p.query("insert into tenants(kind,name,status) values('vendor','Dev Sample Vendor','pending') returning id")).rows[0].id;
await p.query("insert into vendor_profiles(tenant_id,display_name,slug) values($1,'Dev Sample Vendor','dev-sample')", [t]);
await p.query("insert into subscriptions(tenant_id,status) values($1,'pending')", [t]);
await activateSubscription(t, plan, `dev-seed-${t}`);
await p.query('insert into vendor_pricing(tenant_id,per_mp_paise,min_paise) values($1,500,1000)', [t]);
const cust = await createUser('dev.customer@example.test', pw, t, 'customer');
await createUser('dev.admin@example.test', pw, t, 'vendor_admin');
await createUser('dev.counter@example.test', pw, t, 'vendor_counter');
await postEntry(p, await ensureAccount(p, t, 'customer_service_credit', cust), 100000, 'dev_seed', `dev-${t}-c`);
await postEntry(p, await ensureAccount(p, t, 'vendor_processing_credit', null), 100000, 'dev_seed', `dev-${t}-v`);
// Platform staff for trying the admin and finance screens. Two finance people, because approvals need a second person.
let pt = (await p.query("select id from tenants where kind='platform' order by created_at limit 1")).rows[0]?.id;
if (!pt) pt = (await p.query("insert into tenants(kind,name) values('platform','Platform') returning id")).rows[0].id;
for (const [email, role] of [['dev.owner@example.test', 'platform_owner'], ['dev.support@example.test', 'platform_support'], ['dev.finance@example.test', 'platform_finance'], ['dev.finance2@example.test', 'platform_finance']] as const)
  if (!(await p.query('select 1 from users where email=$1', [email])).rowCount) await createUser(email, pw, pt, role);
await createUser('dev.vfinance@example.test', pw, t, 'vendor_finance');
console.log('  platform: dev.owner@, dev.support@, dev.finance@, dev.finance2@example.test\n  store finance: dev.vfinance@example.test');
console.log(`Seeded dev vendor. Password for all: ${process.env.SEED_PASSWORD ? '(from SEED_PASSWORD)' : pw}\n  customer: dev.customer@example.test\n  vendor admin: dev.admin@example.test\n  counter staff: dev.counter@example.test`);
await closePool();
