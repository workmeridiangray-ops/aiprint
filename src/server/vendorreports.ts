import { getPool, AppError } from './db';
import type { Actor } from './auth';
import { audit } from './identity';
import { csvRow } from '../lib/csv';

/** SC-031 vendor reports. Every call re-checks the caller's role and scopes by the caller's own store; nothing here reads artwork.
 *  CSV is generated on request (no queue), so permission is checked at the moment of export. Retail sales are never labelled profit (no cost inputs exist). */
export const REPORTS = ['sales', 'receipts', 'usage', 'credits', 'staff'] as const;
export type ReportKind = typeof REPORTS[number];
export type Filters = { from?: string; to?: string; status?: string; channel?: string; staffId?: string };
const MAX_ROWS = 5000;
const JOB_STATUSES = ['awaiting_funds', 'reserved', 'queued', 'running', 'succeeded', 'failed', 'cancellation_requested', 'cancelled'];

function need(actor: Actor, kind: ReportKind) {
  const roles = kind === 'staff' ? ['vendor_admin'] : ['vendor_admin', 'vendor_finance'];
  if (!roles.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
}
/** A date (YYYY-MM-DD) is read as an Indian date. `to` is inclusive, so the query uses the start of the next day. */
function day(v: string | undefined, plusDays = 0): string | null {
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new AppError('invalid_filter', 'Dates must look like 2026-11-30', 400);
  return new Date(Date.parse(v + 'T00:00:00+05:30') + plusDays * 86400_000).toISOString();
}
const ist = (d: Date | string) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
const rup = (p: number | string) => (Number(p) / 100).toFixed(2);

export type Report = { kind: ReportKind; columns: string[]; rows: (string | number)[][]; totals: Record<string, number | string>; truncated: boolean; note: string };

export async function runReport(actor: Actor, kind: ReportKind, f: Filters = {}): Promise<Report> {
  if (!REPORTS.includes(kind)) throw new AppError('invalid_filter', 'Unknown report', 400);
  need(actor, kind);
  const from = day(f.from), to = day(f.to, 1), t = actor.tenantId, p = getPool();
  if (f.status && kind === 'sales' && !JOB_STATUSES.includes(f.status)) throw new AppError('invalid_filter', 'Unknown status', 400);
  if (f.channel && !['online', 'counter'].includes(f.channel)) throw new AppError('invalid_filter', 'Channel must be online or counter', 400);
  if (f.staffId && !/^[0-9a-f-]{36}$/.test(f.staffId)) throw new AppError('invalid_filter', 'Invalid staff filter', 400);
  const lim = MAX_ROWS + 1;
  let columns: string[], rows: (string | number)[][], totals: Record<string, number | string>, note: string;

  if (kind === 'sales') {
    const r = (await p.query(`select j.created_at, j.status, q.channel, q.customer_amount_paise, q.vendor_charge_paise, q.settings_snapshot,
        coalesce(cc.name, u.email) as customer
      from jobs j join reservations rs on rs.id=j.reservation_id join quotes q on q.id=rs.quote_id join projects pr on pr.id=q.project_id
      join users u on u.id=pr.owner_user_id left join counter_payments cp on cp.quote_id=q.id left join counter_customers cc on cc.id=cp.counter_customer_id
      where j.tenant_id=$1 and ($2::timestamptz is null or j.created_at>=$2) and ($3::timestamptz is null or j.created_at<$3)
        and ($4::text is null or j.status=$4) and ($5::text is null or q.channel=$5) order by j.created_at desc limit ${lim}`, [t, from, to, f.status ?? null, f.channel ?? null])).rows;
    columns = ['Date (IST)', 'Customer', 'Channel', 'Size (mm)', 'Format', 'Status', 'Sale to customer (INR)', 'Platform processing charge (INR)'];
    rows = r.slice(0, MAX_ROWS).map(x => { const s = x.settings_snapshot ?? {}; return [ist(x.created_at), x.customer, x.channel, `${s.widthMm ?? '?'} x ${s.heightMm ?? '?'}`, String(s.format ?? '?').toUpperCase(), x.status, rup(x.customer_amount_paise), rup(x.vendor_charge_paise)]; });
    const ok = r.slice(0, MAX_ROWS).filter(x => x.status === 'succeeded');
    totals = { rows: rows.length, succeededJobs: ok.length, succeededSalesPaise: ok.reduce((a, x) => a + Number(x.customer_amount_paise), 0), succeededProcessingChargePaise: ok.reduce((a, x) => a + Number(x.vendor_charge_paise), 0) };
    note = 'Totals count finished (succeeded) jobs only. This is gross sales and the platform processing charge; it is not profit because your own costs are not recorded here.';
  } else if (kind === 'receipts') {
    const r = (await p.query(`select cp.created_at, cp.receipt_no, cp.method, cp.amount_paise, cp.reference, cp.override_reason, cc.name as customer, u.email as staff
      from counter_payments cp join counter_customers cc on cc.id=cp.counter_customer_id join users u on u.id=cp.recorded_by
      where cp.tenant_id=$1 and ($2::timestamptz is null or cp.created_at>=$2) and ($3::timestamptz is null or cp.created_at<$3) and ($4::uuid is null or cp.recorded_by=$4)
      order by cp.created_at desc limit ${lim}`, [t, from, to, f.staffId ?? null])).rows;
    columns = ['Date (IST)', 'Receipt', 'Customer', 'Method', 'Amount (INR)', 'Reference', 'Recorded by', 'Override reason'];
    rows = r.slice(0, MAX_ROWS).map(x => [ist(x.created_at), x.receipt_no, x.customer, x.method ?? 'override', rup(x.amount_paise), x.reference ?? '', x.staff, x.override_reason ?? '']);
    const paid = r.slice(0, MAX_ROWS).filter(x => x.method);
    totals = { rows: rows.length, receipts: paid.length, recordedPaise: paid.reduce((a, x) => a + Number(x.amount_paise), 0), overrides: rows.length - paid.length };
    note = 'Counter payments are recorded by your staff outside this platform. The platform did not collect this money.';
  } else if (kind === 'usage') {
    const r = (await p.query(`select (j.created_at at time zone 'Asia/Kolkata')::date as d, j.status, count(*)::int n from jobs j
      where j.tenant_id=$1 and ($2::timestamptz is null or j.created_at>=$2) and ($3::timestamptz is null or j.created_at<$3) group by 1,2 order by 1 desc,2 limit ${lim}`, [t, from, to])).rows;
    columns = ['Date (IST)', 'Status', 'Jobs'];
    rows = r.slice(0, MAX_ROWS).map(x => [new Date(x.d).toLocaleDateString('en-CA'), x.status, x.n]);
    totals = { rows: rows.length, jobs: r.slice(0, MAX_ROWS).reduce((a, x) => a + x.n, 0), succeeded: r.slice(0, MAX_ROWS).filter(x => x.status === 'succeeded').reduce((a, x) => a + x.n, 0) };
    note = 'Jobs per day and status, counted from the job records.';
  } else if (kind === 'credits') {
    const r = (await p.query(`select e.created_at, e.amount_paise, e.reason from ledger_entries e join ledger_accounts a on a.id=e.account_id
      where a.tenant_id=$1 and a.kind='vendor_processing_credit' and ($2::timestamptz is null or e.created_at>=$2) and ($3::timestamptz is null or e.created_at<$3) order by e.id desc limit ${lim}`, [t, from, to])).rows;
    const bal = (await p.query("select coalesce(sum(e.amount_paise),0)::bigint b from ledger_entries e join ledger_accounts a on a.id=e.account_id where a.tenant_id=$1 and a.kind='vendor_processing_credit'", [t])).rows[0].b;
    columns = ['Date (IST)', 'Change (INR)', 'Reason'];
    rows = r.slice(0, MAX_ROWS).map(x => [ist(x.created_at), rup(x.amount_paise), x.reason]);
    totals = { rows: rows.length, netChangePaise: r.slice(0, MAX_ROWS).reduce((a, x) => a + Number(x.amount_paise), 0), currentBalancePaise: Number(bal) };
    note = 'Entries on your processing-credit ledger. The current balance is the sum of all entries ever made, not only the filtered ones.';
  } else {
    const r = (await p.query(`select u.email, a.action, count(*)::int n, max(a.at) last_at from audit_log a join users u on u.id=a.actor_user_id
      where a.tenant_id=$1 and ($2::timestamptz is null or a.at>=$2) and ($3::timestamptz is null or a.at<$3) and ($4::uuid is null or a.actor_user_id=$4)
        and exists (select 1 from memberships m where m.user_id=a.actor_user_id and m.tenant_id=$1 and m.role like 'vendor\\_%')
      group by u.email, a.action order by u.email, a.action limit ${lim}`, [t, from, to, f.staffId ?? null])).rows;
    columns = ['Staff', 'Action', 'Times', 'Last at (IST)'];
    rows = r.slice(0, MAX_ROWS).map(x => [x.email, x.action, x.n, ist(x.last_at)]);
    totals = { rows: rows.length, actions: r.slice(0, MAX_ROWS).reduce((a, x) => a + x.n, 0) };
    note = 'Counts of recorded actions by your staff, from the audit log. Only actions the system records appear here.';
  }
  return { kind, columns, rows, totals, truncated: (rows.length >= MAX_ROWS), note };
}

export async function reportCsv(actor: Actor, kind: ReportKind, f: Filters = {}) {
  const r = await runReport(actor, kind, f);
  const lines = [csvRow(r.columns), ...r.rows.map(x => csvRow(x))];
  await audit(getPool(), { actor: actor.userId, tenant: actor.tenantId, action: 'vendor.report_export', type: 'report', id: kind, outcome: `${r.rows.length} rows` });
  return lines.join('\r\n') + '\r\n';
}
export async function staffList(actor: Actor) {
  need(actor, 'receipts');
  return (await getPool().query("select u.id, u.email from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.role like 'vendor\\_%' and m.revoked_at is null order by u.email", [actor.tenantId])).rows as { id: string; email: string }[];
}
