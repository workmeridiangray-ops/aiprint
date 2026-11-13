import type pg from 'pg';
import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { audit } from './identity';
import { ensureAccount, ensureOrgAccount, postEntry, available } from './ledger';
import { getProvider, signSandboxEvent, type ProviderEvent, type OrderState } from './providers';
import { activateSubscription } from './vendor';

type Q = { query: pg.Pool['query'] };
export const FIN = ['platform_owner', 'platform_finance'];
export const LIMITS = { customerMin: 10000, customerMax: 1000000, vendorMin: 10000, vendorMax: 10000000, expireMinutes: 30 };
export function needFinance(actor: Actor) { if (!FIN.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403); }

/* ---------- finance exceptions (SC-069): every mismatch gets one tracked record with an owner and evidence-backed closure ---------- */
export async function raiseException(c: Q, x: { kind: string; dedupeKey: string; tenantId?: string | null; paymentId?: string | null; detail: string }) {
  await c.query('insert into finance_exceptions(kind,dedupe_key,tenant_id,payment_id,detail) values($1,$2,$3,$4,$5) on conflict (dedupe_key) do nothing', [x.kind, x.dedupeKey, x.tenantId ?? null, x.paymentId ?? null, x.detail]);
}
export async function listExceptions(actor: Actor, status?: string) {
  needFinance(actor);
  const r = await getPool().query(`select x.id, x.reference, x.kind, x.detail, x.status, x.next_action, x.due_at, x.resolution, x.evidence, x.created_at, x.resolved_at, t.name as tenant, u.email as owner
    from finance_exceptions x left join tenants t on t.id=x.tenant_id left join users u on u.id=x.owner_user_id where ($1::text is null or x.status=$1) order by (x.status='resolved'), x.created_at desc limit 200`, [status || null]);
  return r.rows;
}
export async function updateException(actor: Actor, id: string, p: { action: 'take' | 'note' | 'resolve'; nextAction?: string; dueAt?: string; resolution?: string; evidence?: string }) {
  needFinance(actor);
  return tx(async c => {
    const x = (await c.query('select status from finance_exceptions where id=$1 for update', [id])).rows[0];
    if (!x) throw new AppError('not_found', 'Exception not found', 404);
    if (x.status === 'resolved') throw new AppError('invalid_transition', 'This exception is already resolved', 409);
    if (p.action === 'take') await c.query("update finance_exceptions set status='investigating', owner_user_id=$2 where id=$1", [id, actor.userId]);
    else if (p.action === 'note') {
      const due = p.dueAt ? new Date(p.dueAt) : null; if (due && isNaN(+due)) throw new AppError('invalid_date', 'The deadline is not a valid date');
      await c.query("update finance_exceptions set next_action=$2, due_at=$3, status='investigating', owner_user_id=coalesce(owner_user_id,$4) where id=$1", [id, String(p.nextAction ?? '').trim().slice(0, 500) || null, due, actor.userId]);
    } else {
      const res = String(p.resolution ?? '').trim(), ev = String(p.evidence ?? '').trim();
      if (res.length < 10 || ev.length < 3) throw new AppError('evidence_required', 'Closing needs a description of what was done and a reference to the evidence');
      await c.query("update finance_exceptions set status='resolved', resolution=$2, evidence=$3, resolved_by=$4, resolved_at=now() where id=$1", [id, res.slice(0, 2000), ev.slice(0, 500), actor.userId]);
    }
    await audit(c, { actor: actor.userId, action: 'finance.exception_' + p.action, type: 'finance_exception', id, outcome: 'ok' });
    return { ok: true };
  });
}

/* ---------- payment intents ---------- */
export type NewPayment = { purpose: 'customer_topup' | 'org_topup' | 'vendor_topup' | 'subscription'; amountPaise?: number; orgId?: string; planId?: string };
export async function createPayment(actor: Actor, p: NewPayment) {
  const provider = getProvider(); // throws when no provider is configured: nothing can be paid
  const pool = getPool();
  let amount = Number(p.amountPaise), orgId: string | null = null, planId: string | null = null;
  const bounds = (min: number, max: number) => { if (!Number.isInteger(amount) || amount < min || amount > max) throw new AppError('invalid_amount', `Amount must be between ₹${min / 100} and ₹${max / 100}`); };
  const t = (await pool.query('select kind, status from tenants where id=$1', [actor.tenantId])).rows[0];
  if (p.purpose === 'customer_topup') {
    if (actor.role !== 'customer' || t.status !== 'active') throw new AppError('denied', 'Not permitted', 403);
    bounds(LIMITS.customerMin, LIMITS.customerMax);
  } else if (p.purpose === 'org_topup') {
    const m = (await pool.query("select 1 from org_members m join organisations o on o.id=m.org_id where m.org_id=$1 and m.user_id=$2 and m.role='admin' and m.revoked_at is null and o.status='active' and o.tenant_id=$3", [p.orgId, actor.userId, actor.tenantId])).rowCount;
    if (!m || actor.role !== 'customer') throw new AppError('not_found', 'Organisation not found', 404); // members cannot manage shared top-ups
    bounds(LIMITS.customerMin, LIMITS.customerMax); orgId = p.orgId!;
  } else if (p.purpose === 'vendor_topup') {
    if (!['vendor_admin', 'vendor_finance'].includes(actor.role) || t.kind !== 'vendor') throw new AppError('denied', 'Not permitted', 403);
    bounds(LIMITS.vendorMin, LIMITS.vendorMax);
  } else if (p.purpose === 'subscription') {
    if (actor.role !== 'vendor_admin' || t.kind !== 'vendor') throw new AppError('denied', 'Not permitted', 403);
    const s = (await pool.query('select status, scheduled_plan_id, current_period_id from subscriptions where tenant_id=$1', [actor.tenantId])).rows[0];
    if (!s) throw new AppError('not_found', 'Subscription not found', 404);
    if (['suspended', 'cancelled'].includes(s.status)) throw new AppError('invalid_transition', `A ${s.status} subscription cannot be renewed`, 409);
    // The price is read on the server from the newest version of the chosen plan; whatever the browser sent as an amount is ignored.
    const pl = (await pool.query('select p.id, p.monthly_price_paise from plans p where p.id=$1 and p.version=(select max(version) from plans x where x.code=p.code)', [p.planId])).rows[0];
    if (!pl) throw new AppError('invalid_plan', 'That plan is not available');
    amount = Number(pl.monthly_price_paise); planId = pl.id;
    if (!(amount > 0)) throw new AppError('invalid_amount', 'This plan has no price to pay. Contact the platform owner.');
  } else throw new AppError('invalid_purpose', 'Unknown payment purpose');

  const row = (await pool.query('insert into payments(tenant_id,user_id,purpose,org_id,plan_id,amount_paise,provider) values($1,$2,$3,$4,$5,$6,$7) returning id', [actor.tenantId, actor.userId, p.purpose, orgId, planId, amount, provider.name])).rows[0];
  let order: { orderId: string; publicKey?: string };
  try { order = await provider.createOrder({ amountPaise: amount, currency: 'INR', receipt: row.id }); }
  catch (e) { await pool.query("update payments set status='failed', note='The provider did not create an order', updated_at=now() where id=$1", [row.id]); throw e; }
  await pool.query("update payments set provider_order_id=$2, status='pending', updated_at=now() where id=$1", [row.id, order.orderId]);
  await audit(pool, { actor: actor.userId, tenant: actor.tenantId, action: 'payment.created', type: 'payment', id: row.id, outcome: p.purpose });
  return { paymentId: row.id as string, provider: provider.name, testMode: provider.testMode, orderId: order.orderId, publicKey: order.publicKey ?? null, amountPaise: amount, currency: 'INR' };
}

/** Applies a provider-confirmed state to one payment, under its row lock, exactly once. Returns what happened. */
async function settle(c: Q, payment: any, s: { paid: boolean; failed?: boolean; paymentId: string | null; amountPaise: number | null; currency: string | null }): Promise<string> {
  if (payment.status === 'success') return 'already_success';
  if (payment.status === 'quarantined') return 'quarantined';
  if (!s.paid) {
    if (s.failed && ['created', 'pending'].includes(payment.status)) { await c.query("update payments set status='failed', updated_at=now() where id=$1", [payment.id]); return 'failed'; }
    return 'no_change';
  }
  if (s.amountPaise !== Number(payment.amount_paise) || s.currency !== payment.currency) {
    await c.query("update payments set status='quarantined', provider_payment_id=coalesce(provider_payment_id,$2), note=$3, updated_at=now() where id=$1", [payment.id, s.paymentId, 'The provider reported a different amount or currency']);
    await raiseException(c, { kind: 'amount_mismatch', dedupeKey: 'mismatch:' + payment.id, tenantId: payment.tenant_id, paymentId: payment.id, detail: `Expected ${payment.amount_paise} ${payment.currency}; the provider reported ${s.amountPaise} ${s.currency}. Nothing was credited.` });
    await audit(c, { tenant: payment.tenant_id, action: 'payment.quarantined', type: 'payment', id: payment.id, outcome: 'amount_mismatch' });
    return 'quarantined';
  }
  // A late success after local expiry or failure is still honoured: the provider's record is the truth.
  await c.query("update payments set status='success', provider_payment_id=coalesce($2,provider_payment_id), updated_at=now() where id=$1", [payment.id, s.paymentId]);
  if (payment.purpose !== 'subscription') {
    const acc = payment.purpose === 'org_topup' ? await ensureOrgAccount(c, payment.tenant_id, payment.org_id)
      : await ensureAccount(c, payment.tenant_id, payment.purpose === 'vendor_topup' ? 'vendor_processing_credit' : 'customer_service_credit', payment.purpose === 'vendor_topup' ? null : payment.user_id);
    await postEntry(c, acc, Number(payment.amount_paise), 'topup', 'pay:' + payment.id);
    await c.query('update payments set credited_at=now() where id=$1', [payment.id]);
  }
  await c.query("insert into email_outbox(to_email,template,body) select email,'payment_result',$2 from users where id=$1 and status='active'", [payment.user_id, JSON.stringify({ status: 'success', amount: `₹${(Number(payment.amount_paise) / 100).toFixed(2)}` })]);
  await audit(c, { tenant: payment.tenant_id, action: 'payment.success', type: 'payment', id: payment.id, outcome: payment.purpose });
  return 'success';
}
/** Subscription activation runs in its own transaction and is idempotent on the payment reference, so it is safe to repeat after a crash. */
async function finishSubscription(paymentId: string) {
  const p = (await getPool().query("select id, tenant_id, plan_id from payments where id=$1 and purpose='subscription' and status='success' and credited_at is null", [paymentId])).rows[0];
  if (!p) return;
  try { await activateSubscription(p.tenant_id, p.plan_id, 'pay:' + p.id); await getPool().query('update payments set credited_at=now() where id=$1', [p.id]); }
  catch (e: any) { await raiseException(getPool(), { kind: 'subscription_not_applied', dedupeKey: 'sub:' + p.id, tenantId: p.tenant_id, paymentId: p.id, detail: `Payment succeeded but the subscription could not be activated: ${String(e.message).slice(0, 200)}` }); }
}

/** Entry point for a verified provider event. Duplicate deliveries are recognised by (provider, event id) and change nothing. */
export async function applyEvent(providerName: string, e: ProviderEvent) {
  const out = await tx(async c => {
    const ins = await c.query('insert into payment_events(provider,event_id,kind,provider_order_id,provider_payment_id,amount_paise,currency,outcome) values($1,$2,$3,$4,$5,$6,$7,$8) on conflict (provider,event_id) do nothing returning id',
      [providerName, e.eventId, e.kind, e.orderId, e.paymentId, e.amountPaise, e.currency, 'received']);
    if (!ins.rowCount) return { outcome: 'duplicate', paymentId: null as string | null };
    const done = async (outcome: string, paymentId: string | null) => { await c.query('update payment_events set outcome=$2, payment_id=$3 where id=$1', [ins.rows[0].id, outcome, paymentId]); return { outcome, paymentId }; };
    if (e.kind === 'other' || !e.orderId) return done('ignored', null);
    const p = (await c.query('select * from payments where provider=$1 and provider_order_id=$2 for update', [providerName, e.orderId])).rows[0];
    if (!p) {
      if (e.kind === 'payment_success') await raiseException(c, { kind: 'unmatched_payment', dedupeKey: `unmatched:${providerName}:${e.paymentId ?? e.orderId}`, detail: `The provider reported a successful payment (${e.paymentId ?? 'no id'}) for an order this system does not know (${e.orderId}). Nothing was credited.` });
      return done('unmatched', null);
    }
    return done(await settle(c, p, { paid: e.kind === 'payment_success', failed: e.kind === 'payment_failed', paymentId: e.paymentId, amountPaise: e.amountPaise, currency: e.currency }), p.id);
  });
  if (out.outcome === 'success' && out.paymentId) await finishSubscription(out.paymentId);
  return out;
}
export async function handleWebhook(providerName: string, rawBody: string, signature: string | null, eventIdHeader: string | null) {
  const provider = getProvider();
  if (provider.name !== providerName) throw new AppError('not_found', 'Not found', 404);
  return applyEvent(provider.name, provider.verifyWebhook(rawBody, signature, eventIdHeader));
}

/** Asks the provider for the truth about one payment (browser closed, missed webhook, late success). */
export async function syncPayment(paymentId: string) {
  const pre = (await getPool().query('select provider, provider_order_id, status from payments where id=$1', [paymentId])).rows[0];
  if (!pre?.provider_order_id) return 'no_order';
  const provider = getProvider(); if (provider.name !== pre.provider) return 'other_provider';
  const st: OrderState = await provider.fetchOrder(pre.provider_order_id);
  const outcome = await tx(async c => {
    const p = (await c.query('select * from payments where id=$1 for update', [paymentId])).rows[0];
    return settle(c, p, { paid: st.status === 'paid', failed: st.status === 'failed', paymentId: st.paymentId, amountPaise: st.amountPaise, currency: st.currency });
  });
  if (outcome === 'success') await finishSubscription(paymentId);
  return outcome;
}
/** Scheduled: look up unfinished payments, expire abandoned ones, and re-check recently expired or failed ones for a late success. Safe to rerun. */
export async function reconcilePayments(now = new Date()) {
  let provider; try { provider = getProvider(); } catch { return { skipped: 'no provider configured' }; }
  const pool = getPool(); const res = { checked: 0, succeeded: 0, expired: 0, errors: 0 };
  const rows = (await pool.query("select id, status, created_at from payments where provider=$1 and provider_order_id is not null and (status in ('created','pending') or (status in ('expired','failed') and created_at > $2::timestamptz - interval '3 days')) order by created_at limit 500", [provider.name, now])).rows;
  for (const r of rows) {
    try {
      res.checked++; const o = await syncPayment(r.id);
      if (o === 'success') res.succeeded++;
      else if (['created', 'pending'].includes(r.status) && o === 'no_change' && +now - +new Date(r.created_at) > LIMITS.expireMinutes * 60000) { const u = await pool.query("update payments set status='expired', updated_at=now() where id=$1 and status in ('created','pending')", [r.id]); res.expired += u.rowCount ?? 0; }
    } catch { res.errors++; }
  }
  for (const r of (await pool.query("select id from payments where purpose='subscription' and status='success' and credited_at is null")).rows) await finishSubscription(r.id);
  return res;
}

/* ---------- reads ---------- */
export async function getPayment(actor: Actor, id: string) {
  const p = (await getPool().query('select id, purpose, amount_paise, currency, status, provider, provider_order_id, created_at from payments where id=$1 and user_id=$2 and tenant_id=$3', [id, actor.userId, actor.tenantId])).rows[0];
  if (!p) throw new AppError('not_found', 'Payment not found', 404);
  let testMode = false, publicKey: string | null = null; try { const pr = getProvider(); testMode = pr.testMode; publicKey = pr.name === 'razorpay' ? process.env.RAZORPAY_KEY_ID ?? null : null; } catch { /* provider removed since */ }
  return { id: p.id, purpose: p.purpose, amountPaise: Number(p.amount_paise), currency: p.currency, status: p.status, provider: p.provider, orderId: p.provider_order_id, testMode, publicKey, createdAt: p.created_at };
}
/** The payer returning from checkout asks for a fresh look-up. The answer is whatever the provider says, never the URL. */
export async function refreshPayment(actor: Actor, id: string) {
  const p = await getPayment(actor, id);
  if (['created', 'pending', 'expired', 'failed'].includes(p.status)) { try { await syncPayment(id); } catch { /* provider unreachable: status stays as recorded */ } }
  return getPayment(actor, id);
}
/** Development and tests only: plays the part of the provider's hosted page and sends a signed event through the normal webhook path. */
export async function sandboxComplete(actor: Actor, id: string, outcome: 'success' | 'failed') {
  const provider = getProvider(); if (provider.name !== 'sandbox') throw new AppError('not_found', 'Not found', 404);
  const p = (await getPool().query("select id, amount_paise, currency, provider_order_id from payments where id=$1 and user_id=$2 and tenant_id=$3 and provider='sandbox'", [id, actor.userId, actor.tenantId])).rows[0];
  if (!p) throw new AppError('not_found', 'Payment not found', 404);
  const ev: ProviderEvent = { eventId: `sbx_evt_${p.id}_${outcome}`, kind: outcome === 'success' ? 'payment_success' : 'payment_failed', orderId: p.provider_order_id, paymentId: 'sbx_pay_' + p.id, amountPaise: Number(p.amount_paise), currency: p.currency };
  const s = signSandboxEvent(ev);
  return handleWebhook('sandbox', s.body, s.signature, null);
}

/** Own balances, payments and ledger lines for the signed-in customer, vendor or organisation administrator. No other person's records. */
export async function myMoney(actor: Actor) {
  const pool = getPool(); const accounts: { id: string; label: string; kind: string; orgId: string | null }[] = [];
  if (actor.role === 'customer') {
    accounts.push({ id: await ensureAccount(pool, actor.tenantId, 'customer_service_credit', actor.userId), label: 'Your credit', kind: 'customer', orgId: null });
    for (const o of (await pool.query("select o.id, o.name from org_members m join organisations o on o.id=m.org_id where m.user_id=$1 and m.role='admin' and m.revoked_at is null and o.status='active' and o.tenant_id=$2", [actor.userId, actor.tenantId])).rows)
      accounts.push({ id: await ensureOrgAccount(pool, actor.tenantId, o.id), label: `${o.name} (shared credit)`, kind: 'org', orgId: o.id });
  } else if (['vendor_admin', 'vendor_finance'].includes(actor.role)) {
    accounts.push({ id: await ensureAccount(pool, actor.tenantId, 'vendor_processing_credit', null), label: 'Processing credit', kind: 'vendor', orgId: null });
  } else throw new AppError('denied', 'Not permitted', 403);
  const out = [];
  for (const a of accounts) {
    const b = await available(pool, a.id);
    const entries = (await pool.query('select amount_paise, reason, created_at from ledger_entries where account_id=$1 order by id desc limit 50', [a.id])).rows.map(e => ({ amountPaise: Number(e.amount_paise), reason: e.reason as string, at: e.created_at }));
    out.push({ ...a, settledPaise: b.settled, heldPaise: b.held, availablePaise: b.available, entries });
  }
  const pays = (await pool.query(`select id, purpose, amount_paise, status, created_at from payments where tenant_id=$1 and ${actor.role === 'customer' ? 'user_id=$2' : "purpose in ('vendor_topup','subscription') and $2::uuid is not null"} order by created_at desc limit 50`, [actor.tenantId, actor.userId])).rows
    .map(p => ({ id: p.id, purpose: p.purpose, amountPaise: Number(p.amount_paise), status: p.status, createdAt: p.created_at }));
  let provider: { available: boolean; testMode: boolean; message?: string }; try { provider = { available: true, testMode: getProvider().testMode }; } catch (e: any) { provider = { available: false, testMode: false, message: e.message }; }
  return { accounts: out, payments: pays, provider, limits: LIMITS };
}

/* ---------- platform finance views (SC-063, SC-064) ---------- */
export async function listPayments(actor: Actor, f: { status?: string; q?: string } = {}) {
  needFinance(actor);
  const r = await getPool().query(`select p.id, p.purpose, p.amount_paise, p.currency, p.status, p.provider, p.provider_order_id, p.provider_payment_id, p.note, p.created_at, p.credited_at, t.name as tenant
    from payments p join tenants t on t.id=p.tenant_id where ($1::text is null or p.status=$1) and ($2::text is null or p.provider_order_id=$2 or p.provider_payment_id=$2 or p.id::text=$2) order by p.created_at desc limit 200`, [f.status || null, f.q?.trim() || null]);
  return r.rows.map(p => ({ ...p, amount_paise: Number(p.amount_paise) }));
}
/** Finance asks the provider again about one payment. This can only record what the provider reports: it cannot mark anything paid by hand. */
export async function financeSync(actor: Actor, id: string) { needFinance(actor); const outcome = await syncPayment(id); await audit(getPool(), { actor: actor.userId, action: 'payment.sync', type: 'payment', id, outcome }); return { outcome }; }
export async function listLedgers(actor: Actor, f: { kind?: string; tenantId?: string } = {}) {
  needFinance(actor);
  const r = await getPool().query(`select a.id, a.kind, t.name as tenant, t.id as tenant_id, u.email as owner, o.name as org,
      coalesce((select sum(amount_paise) from ledger_entries e where e.account_id=a.id),0)::bigint as settled,
      coalesce((select sum(case when r.customer_account_id=a.id then r.customer_paise else r.vendor_paise end) from reservations r where r.status='held' and (r.customer_account_id=a.id or r.vendor_account_id=a.id)),0)::bigint as held
    from ledger_accounts a join tenants t on t.id=a.tenant_id left join users u on u.id=a.owner_user_id left join organisations o on o.id=a.org_id
    where ($1::text is null or a.kind=$1) and ($2::uuid is null or a.tenant_id=$2) order by t.name, a.kind limit 500`, [f.kind || null, f.tenantId || null]);
  await audit(getPool(), { actor: actor.userId, action: 'ledger.list', outcome: `${r.rowCount} accounts` });
  return r.rows.map(a => ({ id: a.id, kind: a.kind, tenant: a.tenant, tenantId: a.tenant_id, owner: a.owner, org: a.org, settledPaise: Number(a.settled), heldPaise: Number(a.held), availablePaise: Number(a.settled) - Number(a.held) }));
}
export async function ledgerEntries(actor: Actor, accountId: string) {
  needFinance(actor);
  const r = await getPool().query('select id, amount_paise, reason, idempotency_key, created_at from ledger_entries where account_id=$1 order by id desc limit 500', [accountId]);
  return r.rows.map(e => ({ id: Number(e.id), amountPaise: Number(e.amount_paise), reason: e.reason, reference: e.idempotency_key, at: e.created_at }));
}
/** Totals that keep the different kinds of money apart: unused customer funds are a liability, not revenue; vendor payable is owed to stores. */
export async function financeTotals(actor: Actor) {
  needFinance(actor);
  const r = (await getPool().query(`select a.kind, coalesce(sum(e.amount_paise),0)::bigint v from ledger_accounts a left join ledger_entries e on e.account_id=a.id group by a.kind`)).rows;
  const by = Object.fromEntries(r.map(x => [x.kind, Number(x.v)]));
  const rev = (await getPool().query("select coalesce(-sum(e.amount_paise),0)::bigint v from ledger_entries e join ledger_accounts a on a.id=e.account_id where a.kind='vendor_processing_credit' and e.reason='job_consumed'")).rows[0];
  const ex = (await getPool().query("select count(*)::int n from finance_exceptions where status<>'resolved'")).rows[0];
  return { customerUnusedPaise: by.customer_service_credit ?? 0, organisationUnusedPaise: by.organisation_service_credit ?? 0, vendorProcessingCreditPaise: by.vendor_processing_credit ?? 0, vendorPayablePaise: by.vendor_payable ?? 0, processingRevenuePaise: Number(rev.v), openExceptions: ex.n as number };
}

/** Subscription screen for the store administrator (SC-022): state, current period, plans on offer, past periods and payments. */
export async function subscriptionInfo(actor: Actor) {
  if (!['vendor_admin', 'vendor_finance'].includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  const pool = getPool();
  const s = (await pool.query(`select s.status, s.scheduled_plan_id, sp.period_start, sp.period_end, pl.id as plan_id, pl.name as plan, pl.code from subscriptions s
    left join subscription_periods sp on sp.id=s.current_period_id left join plans pl on pl.id=sp.plan_id where s.tenant_id=$1`, [actor.tenantId])).rows[0];
  if (!s) return { exists: false as const };
  const plans = (await pool.query('select distinct on (code) id, code, name, staff_seats, monthly_price_paise, storage_mb from plans order by code, version desc')).rows;
  const history = (await pool.query('select sp.period_start, sp.period_end, pl.name from subscription_periods sp join subscriptions s on s.id=sp.subscription_id join plans pl on pl.id=sp.plan_id where s.tenant_id=$1 order by sp.period_start desc limit 24', [actor.tenantId])).rows;
  const tenant = (await pool.query('select status from tenants where id=$1', [actor.tenantId])).rows[0];
  let provider: { available: boolean; testMode: boolean; message?: string }; try { provider = { available: true, testMode: getProvider().testMode }; } catch (e: any) { provider = { available: false, testMode: false, message: e.message }; }
  return { exists: true as const, storeStatus: tenant.status as string, status: s.status as string, plan: s.plan as string | null, planId: s.plan_id as string | null, periodStart: s.period_start, periodEnd: s.period_end, scheduledPlanId: s.scheduled_plan_id as string | null,
    plans: plans.map(p => ({ id: p.id, code: p.code, name: p.name, staffSeats: p.staff_seats, monthlyPricePaise: Number(p.monthly_price_paise), storageMb: p.storage_mb })), history: history.map(h => ({ from: h.period_start, to: h.period_end, plan: h.name })), provider, canPay: actor.role === 'vendor_admin' };
}
/** Who am I: role and workspace, so the sign-in page can send each person to the right place. */
export async function whoAmI(actor: Actor) {
  const t = (await getPool().query('select kind, status, name from tenants where id=$1', [actor.tenantId])).rows[0];
  return { role: actor.role, workspace: t.name as string, workspaceKind: t.kind as string, workspaceStatus: t.status as string };
}
