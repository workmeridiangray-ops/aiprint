// EXPLICIT DEVELOPMENT SEED ONLY. Refuses to run in production/staging.
import pg from 'pg';
import { createUser } from '../src/server/auth';
import { ensureAccount, postEntry } from '../src/server/ledger';
import { closePool, getPool } from '../src/server/db';
if (['production', 'staging'].includes(process.env.APP_ENV ?? '')) { console.error('Refusing to seed in ' + process.env.APP_ENV); process.exit(1); }
const p = getPool();
const t = (await p.query("insert into tenants(kind,name) values('vendor','Dev Sample Vendor') returning id")).rows[0].id;
const uid = await createUser('dev.customer@example.test', 'dev-password-12345', t, 'customer');
await postEntry(p, await ensureAccount(p, t, 'customer_service_credit', uid), 100000, 'dev_seed', `dev-${t}-c`);
await postEntry(p, await ensureAccount(p, t, 'vendor_processing_credit', null), 100000, 'dev_seed', `dev-${t}-v`);
console.log('Seeded dev vendor. Sign in: dev.customer@example.test / dev-password-12345');
await closePool(); void pg;
