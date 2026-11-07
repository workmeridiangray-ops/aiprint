import { assertStorageAvailable, storageState } from './quota';
import type pg from 'pg';
import { z } from 'zod';
import { getPool, tx, AppError } from './db';
import { hashPassword, type Actor } from './auth';
import { audit } from './identity';
import { createHash, randomBytes } from 'node:crypto';
import { available, balance, ensureAccount } from './ledger';

type Q = { query: pg.Pool['query'] };
const ADMIN = ['vendor_admin'];
const sha = (t: string) => createHash('sha256').update(t).digest('hex');
function need(actor: Actor, roles: string[]) { if (!roles.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403); }
const Colour = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const GRACE_DAYS = 7; export const PERIOD_DAYS = 30;

/* ---------- onboarding and branding ---------- */
export async function createVendor(input: { email: string; password: string; businessName: string; slug: string; planId?: string }) {
  if (input.password.length < 12) throw new AppError('weak_password', 'Password must be at least 12 characters');
  const name = input.businessName.trim(); if (!name) throw new AppError('invalid_name', 'Business name is required');
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) throw new AppError('invalid_slug', 'Web address must be 3-40 letters, numbers or hyphens');
  return tx(async c => {
    if ((await c.query('select 1 from vendor_profiles where slug=$1', [slug])).rowCount) throw new AppError('slug_taken', 'That web address is taken', 409);
    if ((await c.query('select 1 from users where lower(email)=lower($1)', [input.email.trim()])).rowCount) return { status: 'verification_sent' as const }; // no enumeration; never attaches to an existing account
    if (input.planId && !(await c.query('select 1 from plans where id=$1', [input.planId])).rowCount) throw new AppError('invalid_plan', 'That plan is not available');
    const t = await c.query("insert into tenants(kind,name,status) values('vendor',$1,'pending') returning id", [name]);
    await c.query('insert into vendor_profiles(tenant_id,display_name,slug) values($1,$2,$3)', [t.rows[0].id, name, slug]);
    const u = await c.query('insert into users(email,password_hash) values($1,$2) returning id', [input.email.trim(), hashPassword(input.password)]);
    await c.query("insert into memberships(tenant_id,user_id,role) values($1,$2,'vendor_admin')", [t.rows[0].id, u.rows[0].id]);
    const token = randomBytes(32).toString('base64url');
    await c.query("insert into auth_tokens(purpose,token_hash,user_id,tenant_id,expires_at) values('verify_email',$1,$2,$3, now() + interval '24 hours')", [sha(token), u.rows[0].id, t.rows[0].id]);
    await c.query("insert into email_outbox(to_email,template,body) values($1,'verify_email',$2)", [input.email.trim(), JSON.stringify({ token })]);
    await c.query("insert into subscriptions(tenant_id,status,scheduled_plan_id) values($1,'pending',$2)", [t.rows[0].id, input.planId ?? null]);
    await audit(c, { actor: u.rows[0].id, tenant: t.rows[0].id, action: 'vendor.register', outcome: 'ok' });
    return { status: 'verification_sent' as const };
  });
}
export async function updateBranding(actor: Actor, p: { displayName?: string; primaryColour?: string; supportEmail?: string | null }) {
  need(actor, ADMIN);
  if (p.primaryColour !== undefined && !Colour.safeParse(p.primaryColour).success) throw new AppError('invalid_colour', 'Colour must look like #0f5f63');
  if (p.displayName !== undefined && !p.displayName.trim()) throw new AppError('invalid_name', 'Name is required');
  await getPool().query('update vendor_profiles set display_name=coalesce($2,display_name), primary_colour=coalesce($3,primary_colour), support_email=case when $4::boolean then $5 else support_email end, updated_at=now() where tenant_id=$1',
    [actor.tenantId, p.displayName?.trim() ?? null, p.primaryColour ?? null, p.supportEmail !== undefined, p.supportEmail ?? null]);
  await audit(getPool(), { actor: actor.userId, tenant: actor.tenantId, action: 'vendor.branding', outcome: 'ok' });
}
/** Public: branding only, active vendors only. Nothing else about the tenant is exposed. */
export async function getPortal(slug: string) {
  const r = await getPool().query("select p.tenant_id, p.display_name, p.primary_colour from vendor_profiles p join tenants t on t.id=p.tenant_id where p.slug=$1 and t.status='active'", [slug.toLowerCase()]);
  if (!r.rowCount) throw new AppError('not_found', 'Portal not found', 404);
  return { tenantId: r.rows[0].tenant_id as string, displayName: r.rows[0].display_name as string, primaryColour: r.rows[0].primary_colour as string };
}

/* ---------- plans, subscription state machine ---------- */
export async function createPlan(actor: Actor, p: { code: string; name: string; staffSeats: number; monthlyPricePaise: number; storageMb?: number | null }) {
  need(actor, ['platform_owner']);
  if (!Number.isInteger(p.staffSeats) || p.staffSeats < 1 || !Number.isInteger(p.monthlyPricePaise) || p.monthlyPricePaise < 0) throw new AppError('invalid_plan', 'Seats and price must be whole numbers');
  return tx(async c => {
    const v = await c.query('select coalesce(max(version),0)+1 as v from plans where code=$1', [p.code]);
    if (p.storageMb != null && (!Number.isInteger(p.storageMb) || p.storageMb < 1)) throw new AppError('invalid_plan', 'Storage must be a whole number of megabytes, or empty for unlimited', 400);
    const r = await c.query('insert into plans(code,version,name,staff_seats,monthly_price_paise,created_by,storage_mb) values($1,$2,$3,$4,$5,$6,$7) returning id,version', [p.code, v.rows[0].v, p.name, p.staffSeats, p.monthlyPricePaise, actor.userId, p.storageMb ?? null]);
    await audit(c, { actor: actor.userId, action: 'plan.create', type: 'plan', id: r.rows[0].id, outcome: 'ok' });
    return r.rows[0] as { id: string; version: number };
  });
}
/** Internal: only a verified provider payment event may call this (no HTTP route exposes it, and it is not callable from a browser redirect).
 *  Idempotent on paymentRef. Renewal while active extends from the existing period end; after expiry it starts now. */
export async function activateSubscription(tenantId: string, planId: string, paymentRef: string, now = new Date()) {
  return tx(async c => {
    const dup = await c.query('select id from subscription_periods where payment_ref=$1', [paymentRef]);
    if (dup.rowCount) return { periodId: dup.rows[0].id as string, repeated: true };
    const s = await c.query('select id,status,current_period_id from subscriptions where tenant_id=$1 for update', [tenantId]);
    if (!s.rowCount) throw new AppError('not_found', 'Subscription not found', 404);
    if (['suspended', 'cancelled'].includes(s.rows[0].status)) throw new AppError('invalid_transition', `A ${s.rows[0].status} subscription cannot be renewed by payment`, 409);
    let start = now;
    if (s.rows[0].status === 'active' && s.rows[0].current_period_id) {
      const cur = await c.query('select period_end from subscription_periods where id=$1', [s.rows[0].current_period_id]);
      if (new Date(cur.rows[0].period_end) > now) start = new Date(cur.rows[0].period_end);
    }
    const end = new Date(start.getTime() + PERIOD_DAYS * 86400000);
    const sched = (await c.query('select scheduled_plan_id from subscriptions where id=$1', [s.rows[0].id])).rows[0].scheduled_plan_id;
    const p = await c.query('insert into subscription_periods(subscription_id,plan_id,period_start,period_end,payment_ref) values($1,$2,$3,$4,$5) returning id', [s.rows[0].id, sched ?? planId, start, end, paymentRef]);
    await c.query("update subscriptions set status='active', current_period_id=$2, scheduled_plan_id=null where id=$1", [s.rows[0].id, p.rows[0].id]);
    await c.query("update tenants set status='active' where id=$1 and status='pending'", [tenantId]);
    await audit(c, { tenant: tenantId, action: 'subscription.activated', type: 'subscription', id: s.rows[0].id, outcome: 'ok' });
    return { periodId: p.rows[0].id as string, repeated: false };
  });
}
export async function schedulePlanChange(actor: Actor, planId: string) {
  need(actor, ADMIN);
  const r = await getPool().query('update subscriptions set scheduled_plan_id=$2 where tenant_id=$1 returning id', [actor.tenantId, planId]);
  if (!r.rowCount) throw new AppError('not_found', 'Subscription not found', 404);
  return { status: 'scheduled_for_next_renewal' as const }; // no proration; current period unchanged
}
/** Scheduled job. Pure function of `now`; safe to rerun (reminders deduplicated per period and kind). */
export async function runSubscriptionLifecycle(now = new Date()) {
  return tx(async c => {
    const subs = await c.query(`select s.id, s.tenant_id, s.status, p.id as period_id, p.period_end from subscriptions s join subscription_periods p on p.id=s.current_period_id where s.status in ('active','grace') for update of s`);
    const out = { toGrace: 0, toExpired: 0, reminders: 0 };
    const remind = async (s: any, kind: string) => {
      const ins = await c.query('insert into subscription_reminders(period_id,kind) values($1,$2) on conflict do nothing returning 1', [s.period_id, kind]);
      if (!ins.rowCount) return;
      const admins = await c.query("select u.email from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.role='vendor_admin' and m.revoked_at is null", [s.tenant_id]);
      for (const a of admins.rows) await c.query("insert into email_outbox(to_email,template,body) values($1,$2,$3)", [a.email, `subscription_${kind}`, JSON.stringify({ periodEnd: s.period_end })]);
      out.reminders++;
    };
    for (const s of subs.rows) {
      const end = new Date(s.period_end).getTime(), n = now.getTime();
      const graceEnd = end + GRACE_DAYS * 86400000;
      if (s.status === 'active') {
        if (n >= end) { await c.query("update subscriptions set status='grace' where id=$1", [s.id]); await remind(s, 'grace_start'); out.toGrace++; s.status = 'grace'; }
        else if (end - n <= 86400000) await remind(s, '1d');
        else if (end - n <= 7 * 86400000) await remind(s, '7d');
      }
      if (s.status === 'grace' && n >= graceEnd) { await c.query("update subscriptions set status='expired' where id=$1", [s.id]); await remind(s, 'expired'); out.toExpired++; }
    }
    return out;
  });
}
export async function canProcess(c: Q, tenantId: string) {
  const t = await c.query('select kind,status from tenants where id=$1', [tenantId]);
  if (!t.rowCount || t.rows[0].status !== 'active') return false;
  if (t.rows[0].kind !== 'vendor') return true; // direct/platform channel is not a subscriber
  const s = await c.query('select status from subscriptions where tenant_id=$1', [tenantId]);
  return !!s.rowCount && ['active', 'grace'].includes(s.rows[0].status);
}
export async function seatsInfo(c: Q, tenantId: string) {
  const t = await c.query('select kind from tenants where id=$1', [tenantId]);
  if (t.rows[0]?.kind !== 'vendor') return { used: 0, limit: Infinity };
  const used = (await c.query("select count(*)::int n from memberships where tenant_id=$1 and role like 'vendor\\_%' and revoked_at is null", [tenantId])).rows[0].n as number;
  const p = await c.query('select pl.staff_seats from subscriptions s join subscription_periods sp on sp.id=s.current_period_id join plans pl on pl.id=sp.plan_id where s.tenant_id=$1', [tenantId]);
  return { used, limit: p.rowCount ? (p.rows[0].staff_seats as number) : 1 }; // no active plan: administrator only
}

/* ---------- pricing ---------- */
export async function setPlatformPricing(actor: Actor, perMpPaise: number, minPaise: number) {
  need(actor, ['platform_owner']);
  if (![perMpPaise, minPaise].every(n => Number.isInteger(n) && n >= 0)) throw new AppError('invalid_price', 'Prices must be whole paise');
  await getPool().query('insert into platform_pricing(per_mp_paise,min_paise,created_by) values($1,$2,$3)', [perMpPaise, minPaise, actor.userId]);
  await audit(getPool(), { actor: actor.userId, action: 'pricing.platform', outcome: 'ok' });
}
export async function setRetailPricing(actor: Actor, perMpPaise: number, minPaise: number) {
  need(actor, ADMIN);
  if (![perMpPaise, minPaise].every(n => Number.isInteger(n) && n >= 0)) throw new AppError('invalid_price', 'Prices must be whole paise');
  await getPool().query('insert into vendor_pricing(tenant_id,per_mp_paise,min_paise,created_by) values($1,$2,$3,$4)', [actor.tenantId, perMpPaise, minPaise, actor.userId]);
  await audit(getPool(), { actor: actor.userId, tenant: actor.tenantId, action: 'pricing.retail', outcome: 'ok' });
}
export async function getRetailPricing(actor: Actor) {
  need(actor, ['vendor_admin', 'vendor_finance']);
  const r = await getPool().query('select per_mp_paise, min_paise, created_at from vendor_pricing where tenant_id=$1 order by created_at desc, id desc limit 1', [actor.tenantId]);
  return r.rows[0] ?? null;
}
/** Price for one operation. Throws if configuration is missing: there are no hidden default prices. */
export async function priceFor(c: Q, tenantId: string, totalPixels: number) {
  const mp = totalPixels / 1_000_000;
  const t = await c.query('select kind from tenants where id=$1', [tenantId]);
  const rp = await c.query('select id, per_mp_paise, min_paise from vendor_pricing where tenant_id=$1 order by created_at desc, id desc limit 1', [tenantId]);
  if (!rp.rowCount) throw new AppError('pricing_not_configured', 'This service has not set its prices yet', 409);
  const customer = Math.max(Number(rp.rows[0].min_paise), Math.ceil(mp * Number(rp.rows[0].per_mp_paise)));
  let vendor = 0, platformId: string | null = null;
  if (t.rows[0].kind === 'vendor') {
    const pp = await c.query('select id, per_mp_paise, min_paise from platform_pricing order by created_at desc, id desc limit 1');
    if (!pp.rowCount) throw new AppError('pricing_not_configured', 'Platform processing prices are not configured', 409);
    vendor = Math.max(Number(pp.rows[0].min_paise), Math.ceil(mp * Number(pp.rows[0].per_mp_paise))); platformId = pp.rows[0].id;
  } // direct channel: no vendor processing charge and no vendor payable
  return { customer, vendor, retailId: rp.rows[0].id as string, platformId };
}

/* ---------- staff ---------- */
export async function listStaff(actor: Actor) {
  need(actor, ADMIN);
  const r = await getPool().query("select m.id, u.email, m.role, m.created_at from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.revoked_at is null and m.role like 'vendor\\_%' order by m.created_at", [actor.tenantId]);
  return { staff: r.rows, seats: await seatsInfo(getPool(), actor.tenantId) };
}
export async function changeRole(actor: Actor, membershipId: string, role: string) {
  need(actor, ADMIN);
  if (!['vendor_admin', 'vendor_counter', 'vendor_support', 'vendor_finance'].includes(role)) throw new AppError('invalid_role', 'Role cannot be assigned');
  return tx(async c => {
    const m = await c.query('select id,tenant_id,role from memberships where id=$1 and revoked_at is null for update', [membershipId]);
    if (!m.rowCount || m.rows[0].tenant_id !== actor.tenantId || !m.rows[0].role.startsWith('vendor_')) throw new AppError('not_found', 'Member not found', 404);
    if (m.rows[0].role === 'vendor_admin' && role !== 'vendor_admin') {
      const admins = await c.query("select id from memberships where tenant_id=$1 and role='vendor_admin' and revoked_at is null for update", [actor.tenantId]);
      if (admins.rowCount! <= 1) throw new AppError('last_admin', 'The last administrator cannot be changed. Add another administrator first.', 409);
    }
    await c.query('update memberships set role=$2 where id=$1', [membershipId, role]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'membership.role', type: 'membership', id: membershipId, outcome: 'ok' });
  });
}

/* ---------- counter workflow ---------- */
export async function createCounterCustomer(actor: Actor, name: string, contact?: string) {
  need(actor, ['vendor_counter', 'vendor_admin']);
  if (!name.trim()) throw new AppError('invalid_name', 'Customer name is required');
  const r = await getPool().query('insert into counter_customers(tenant_id,name,contact,created_by) values($1,$2,$3,$4) returning id', [actor.tenantId, name.trim().slice(0, 120), contact?.trim() || null, actor.userId]);
  return { id: r.rows[0].id as string };
}
export async function createCounterProject(actor: Actor, counterCustomerId: string, name: string) {
  need(actor, ['vendor_counter', 'vendor_admin']);
  const cc = await getPool().query('select 1 from counter_customers where id=$1 and tenant_id=$2', [counterCustomerId, actor.tenantId]);
  if (!cc.rowCount) throw new AppError('not_found', 'Customer not found', 404);
  const r = await getPool().query('insert into projects(tenant_id,owner_user_id,name,counter_customer_id) values($1,$2,$3,$4) returning id,revision', [actor.tenantId, actor.userId, name.slice(0, 120) || 'Counter job', counterCustomerId]);
  return r.rows[0] as { id: string; revision: number };
}
/** Records money the vendor took outside the platform (or an admin override with reason). Creates NO ledger entry and NO platform payable. */
export async function recordCounterPayment(actor: Actor, quoteId: string, p: { method?: string; amountPaise?: number; reference?: string; overrideReason?: string }) {
  need(actor, ['vendor_counter', 'vendor_admin']);
  return tx(async c => {
    const q = await c.query('select q.*, pr.counter_customer_id, pr.owner_user_id from quotes q join projects pr on pr.id=q.project_id where q.id=$1 for update of q', [quoteId]);
    const row = q.rows[0];
    if (!row || row.tenant_id !== actor.tenantId || row.channel !== 'counter') throw new AppError('not_found', 'Quote not found', 404);
    if (new Date(row.expires_at) <= new Date()) throw new AppError('quote_expired', 'This price has expired. Request a new price.', 409);
    const dup = await c.query('select receipt_no from counter_payments where quote_id=$1', [quoteId]);
    if (dup.rowCount) return { receiptNo: dup.rows[0].receipt_no as string, repeated: true };
    if (p.overrideReason !== undefined) {
      need(actor, ['vendor_admin']);
      if (p.overrideReason.trim().length < 5) throw new AppError('reason_required', 'Give a reason for releasing without payment');
      const r = await c.query("insert into counter_payments(tenant_id,quote_id,counter_customer_id,amount_paise,recorded_by,override_reason,override_by) values($1,$2,$3,0,$4,$5,$4) returning receipt_no", [actor.tenantId, quoteId, row.counter_customer_id, actor.userId, p.overrideReason.trim()]);
      await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'counter.override', type: 'quote', id: quoteId, outcome: 'ok' });
      return { receiptNo: r.rows[0].receipt_no as string, repeated: false };
    }
    if (!['cash', 'upi_external', 'card_external', 'other'].includes(p.method ?? '')) throw new AppError('invalid_method', 'Choose how the customer paid');
    if (!Number.isInteger(p.amountPaise) || p.amountPaise !== Number(row.customer_amount_paise)) throw new AppError('amount_mismatch', 'The amount must match the quoted price exactly', 400);
    const r = await c.query('insert into counter_payments(tenant_id,quote_id,counter_customer_id,method,amount_paise,reference,recorded_by) values($1,$2,$3,$4,$5,$6,$7) returning receipt_no',
      [actor.tenantId, quoteId, row.counter_customer_id, p.method, p.amountPaise, p.reference?.slice(0, 80) ?? null, actor.userId]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'counter.payment', type: 'quote', id: quoteId, outcome: 'ok' });
    return { receiptNo: r.rows[0].receipt_no as string, repeated: false };
  });
}
/** Holds ONLY the vendor processing credit. Requires a recorded payment or admin override first. */
export async function reserveCounter(actor: Actor, quoteId: string) {
  need(actor, ['vendor_counter', 'vendor_admin']);
  return tx(async c => {
    const q = await c.query('select * from quotes where id=$1 for update', [quoteId]);
    const row = q.rows[0];
    if (!row || row.tenant_id !== actor.tenantId || row.channel !== 'counter') throw new AppError('not_found', 'Quote not found', 404);
    const ex = await c.query('select id from reservations where quote_id=$1', [quoteId]);
    if (ex.rowCount) { const j = await c.query('select id from jobs where reservation_id=$1', [ex.rows[0].id]); return { reservationId: ex.rows[0].id as string, jobId: j.rows[0].id as string, repeated: true }; }
    if (new Date(row.expires_at) <= new Date()) throw new AppError('quote_expired', 'This price has expired. Request a new price.', 409);
    const cur = await c.query('select revision from projects where id=$1', [row.project_id]);
    if (cur.rows[0].revision !== row.project_revision) throw new AppError('quote_stale', 'The artwork changed after this price was given. Request a new price.', 409);
    if (!(await c.query('select 1 from counter_payments where quote_id=$1', [quoteId])).rowCount) throw new AppError('payment_required', 'Record the customer payment, or an administrator override, before processing', 402);
    if (!(await canProcess(c, actor.tenantId))) throw new AppError('subscription_inactive', 'This store cannot process new work right now', 402);
    await assertStorageAvailable(c, actor.tenantId);
    const vendAcc = await ensureAccount(c, actor.tenantId, 'vendor_processing_credit', null);
    await c.query('select 1 from ledger_accounts where id=$1 for update', [vendAcc]);
    if ((await available(c, vendAcc)).available < Number(row.vendor_charge_paise)) throw new AppError('vendor_unavailable', 'Processing credit is too low. Top up before processing counter work.', 402);
    const res = await c.query('insert into reservations(quote_id,customer_account_id,vendor_account_id,customer_paise,vendor_paise) values($1,null,$2,0,$3) returning id', [quoteId, vendAcc, row.vendor_charge_paise]);
    const job = await c.query("insert into jobs(tenant_id,reservation_id,status) values($1,$2,'queued') returning id", [actor.tenantId, res.rows[0].id]);
    return { reservationId: res.rows[0].id as string, jobId: job.rows[0].id as string, repeated: false };
  });
}

/* ---------- reports ---------- */
export async function overview(actor: Actor) {
  need(actor, ['vendor_admin', 'vendor_finance']);
  const p = getPool(), t = actor.tenantId;
  const [cust, jobs, pay, sub, acc, claims] = await Promise.all([
    p.query("select count(*)::int n from memberships where tenant_id=$1 and role='customer' and revoked_at is null", [t]),
    p.query('select status, count(*)::int n from jobs where tenant_id=$1 group by status', [t]),
    p.query('select count(*)::int n, coalesce(sum(amount_paise),0)::bigint total from counter_payments where tenant_id=$1 and method is not null', [t]),
    p.query('select s.status, sp.period_end from subscriptions s left join subscription_periods sp on sp.id=s.current_period_id where s.tenant_id=$1', [t]),
    p.query("select id from ledger_accounts where tenant_id=$1 and kind='vendor_processing_credit'", [t]),
    p.query("select count(*)::int n from walkin_claims where tenant_id=$1 and status in ('pending','conflict')", [t]),
  ]);
  return {
    storage: await storageState(p, t),
    customers: cust.rows[0].n, claimsWaiting: claims.rows[0].n as number, jobsByStatus: Object.fromEntries(jobs.rows.map(r => [r.status, r.n])),
    counterPayments: { count: pay.rows[0].n, totalPaise: Number(pay.rows[0].total), note: 'Recorded outside the platform; not platform-collected money' },
    subscription: sub.rows[0] ?? null, processingCredit: acc.rowCount ? await balance(acc.rows[0].id) : { settled: 0, held: 0, available: 0 },
  };
}

/** SC-024: a store's own customers. Vendor admin sees online accounts and counter records; counter staff see counter records only. Never returns artwork, balances or other stores' people. */
export async function listCustomers(actor: Actor, f: { q?: string; cursor?: string; limit?: number } = {}) {
  need(actor, ['vendor_admin', 'vendor_counter']);
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const like = f.q ? '%' + f.q.trim().slice(0, 80).replace(/[%_\\]/g, m => '\\' + m) + '%' : null;
  let cAt: string | null = null, cId: string | null = null;
  if (f.cursor) { const m = /^([^|]+)\|([0-9a-f-]{36})$/.exec(f.cursor); if (!m || Number.isNaN(Date.parse(m[1]))) throw new AppError('invalid_filter', 'Invalid page marker', 400); cAt = m[1]; cId = m[2]; }
  const online = actor.role === 'vendor_admin';
  const r = await getPool().query(`select * from (
      ${online ? `select 'online'::text as kind, u.id, u.email as label, null::text as contact, m.created_at,
         (select count(*)::int from projects p join quotes q on q.project_id=p.id join reservations rs on rs.quote_id=q.id join jobs j on j.reservation_id=rs.id where p.owner_user_id=u.id and p.tenant_id=$1) as jobs,
         u.closed_at is not null as closed
       from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.role='customer' and m.revoked_at is null
       union all` : ''}
      select 'counter'::text as kind, c.id, c.name as label, c.contact, c.created_at,
         (select count(*)::int from projects p join quotes q on q.project_id=p.id join reservations rs on rs.quote_id=q.id join jobs j on j.reservation_id=rs.id where p.counter_customer_id=c.id) as jobs, false as closed
       from counter_customers c where c.tenant_id=$1
    ) x where ($2::text is null or x.label ilike $2 or x.contact ilike $2)
      and ($3::timestamptz is null or (x.created_at, x.id) < ($3::timestamptz, $4::uuid))
    order by x.created_at desc, x.id desc limit $5`, [actor.tenantId, like, cAt, cId, limit + 1]);
  const rows = r.rows.slice(0, limit);
  const last = rows[rows.length - 1];
  return {
    isAdmin: online,
    rows: rows.map(x => ({ kind: x.kind as 'online' | 'counter', id: x.id as string, name: x.label as string, contact: x.contact as string | null, since: new Date(x.created_at).toISOString(), jobs: x.jobs as number, closed: !!x.closed })),
    nextCursor: r.rows.length > limit ? `${new Date(last.created_at).toISOString()}|${last.id}` : null,
  };
}
