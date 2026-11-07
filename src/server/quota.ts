import type pg from 'pg';
import { AppError } from './db';
type Q = { query: pg.Pool['query'] };

/** Storage allowance comes from the plan of the vendor's current subscription period. Direct/platform tenants and plans without a limit are unlimited.
 *  Usage counts every stored file of the tenant that has not been purged (originals, previews, exports). */
export async function storageState(c: Q, tenantId: string) {
  const used = Number((await c.query('select coalesce(sum(bytes),0)::bigint b from stored_files where tenant_id=$1 and deleted_at is null', [tenantId])).rows[0].b);
  const r = await c.query(`select t.kind, pl.storage_mb from tenants t left join subscriptions s on s.tenant_id=t.id
    left join subscription_periods sp on sp.id=s.current_period_id left join plans pl on pl.id=sp.plan_id where t.id=$1`, [tenantId]);
  const row = r.rows[0];
  const quotaBytes = row && row.kind === 'vendor' && row.storage_mb ? Number(row.storage_mb) * 1024 * 1024 : null;
  return { usedBytes: used, quotaBytes, over: quotaBytes !== null && used >= quotaBytes };
}
/** Blocks NEW uploads and NEW processing only. Downloads, deletions and retention of existing files are never affected, and no paid file is removed to make room. */
export async function assertStorageAvailable(c: Q, tenantId: string, incomingBytes = 0) {
  const s = await storageState(c, tenantId);
  if (s.quotaBytes !== null && (s.over || s.usedBytes + incomingBytes > s.quotaBytes))
    throw new AppError('storage_full', 'This store has reached its storage allowance, so new uploads and new work are paused. Existing files can still be downloaded and deleted. Delete files you no longer need, or ask the store administrator about the plan.', 409);
  return s;
}
