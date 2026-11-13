import type pg from 'pg';
import { getPool, tx, AppError } from './db';

type Q = { query: pg.Pool['query'] };

export async function ensureAccount(c: Q, tenantId: string, kind: 'customer_service_credit' | 'vendor_processing_credit' | 'vendor_payable', ownerUserId: string | null): Promise<string> {
  const found = await c.query(
    `select id from ledger_accounts where tenant_id=$1 and kind=$2 and owner_user_id is not distinct from $3`, [tenantId, kind, ownerUserId]);
  if (found.rowCount) return found.rows[0].id;
  const ins = await c.query(
    `insert into ledger_accounts(tenant_id,kind,owner_user_id) values($1,$2,$3) on conflict do nothing returning id`, [tenantId, kind, ownerUserId]);
  if (ins.rowCount) return ins.rows[0].id;
  return (await c.query(`select id from ledger_accounts where tenant_id=$1 and kind=$2 and owner_user_id is not distinct from $3`, [tenantId, kind, ownerUserId])).rows[0].id;
}

/** Posts an immutable entry. Idempotent on key. Only for verified funding events or explicit dev seeding; never from a browser redirect. */
export async function postEntry(c: Q, accountId: string, amountPaise: number, reason: string, idempotencyKey: string) {
  if (!Number.isInteger(amountPaise) || amountPaise === 0) throw new AppError('invalid_amount', 'Amount must be a non-zero integer number of paise');
  await c.query('insert into ledger_entries(account_id,amount_paise,reason,idempotency_key) values($1,$2,$3,$4) on conflict (idempotency_key) do nothing', [accountId, amountPaise, reason, idempotencyKey]);
}

/** Caller must hold a row lock on the account when deciding. */
export async function available(c: Q, accountId: string): Promise<{ settled: number; held: number; available: number }> {
  const s = await c.query('select coalesce(sum(amount_paise),0)::bigint as v from ledger_entries where account_id=$1', [accountId]);
  const h = await c.query(
    `select coalesce(sum(case when customer_account_id=$1 then customer_paise else vendor_paise end),0)::bigint as v
     from reservations where status='held' and (customer_account_id=$1 or vendor_account_id=$1)`, [accountId]);
  const settled = Number(s.rows[0].v), held = Number(h.rows[0].v);
  return { settled, held, available: settled - held };
}
export async function balance(accountId: string) { return available(getPool(), accountId); }
export { tx };

export async function ensureOrgAccount(c: Q, tenantId: string, orgId: string): Promise<string> {
  const f = await c.query("select id from ledger_accounts where org_id=$1 and kind='organisation_service_credit'", [orgId]);
  if (f.rowCount) return f.rows[0].id;
  const ins = await c.query("insert into ledger_accounts(tenant_id,kind,org_id) values($1,'organisation_service_credit',$2) on conflict do nothing returning id", [tenantId, orgId]);
  if (ins.rowCount) return ins.rows[0].id;
  return (await c.query("select id from ledger_accounts where org_id=$1 and kind='organisation_service_credit'", [orgId])).rows[0].id;
}
