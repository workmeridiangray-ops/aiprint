import { createUser } from '/home/claude/artwork-saas/src/server/auth';
import { getPool, closePool } from '/home/claude/artwork-saas/src/server/db';
const p = getPool();
const t = (await p.query("insert into tenants(kind,name) values('platform','Platform') returning id")).rows[0].id;
await createUser('dev.owner@example.test', 'dev-password-12345', t, 'platform_owner');
await createUser('dev.support@example.test', 'dev-password-12345', t, 'platform_support');
console.log('platform users created'); await closePool();
