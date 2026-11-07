import { getPool, AppError } from './db';
import type { Actor } from './auth';
import { POLICY_SLUGS } from './public';

const STAFF = ['platform_owner', 'platform_support'];
/** Read-only operations overview for platform staff. Contains no customer artwork, files, balances or policy bodies. Owner-only settings are marked so the UI can hide edit forms from support. */
export async function adminOverview(actor: Actor) {
  if (!STAFF.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  const q = (s: string, a: unknown[] = []) => getPool().query(s, a).then(r => r.rows);
  const [enq, plans, pricing, pols, tenants, direct] = await Promise.all([
    q("select status, count(*)::int n from enquiries group by status"),
    q("select distinct on (code) code, version, name, staff_seats, monthly_price_paise from plans order by code, version desc"),
    q("select per_mp_paise, min_paise, created_at from platform_pricing order by created_at desc, id desc limit 1"),
    q("select distinct on (slug) slug, version, effective_date::text as effective_date, approved_by_name from policies order by slug, version desc"),
    q(`select t.id, t.name, t.kind, t.status, t.created_at, p.slug, s.status as subscription, pl.name as plan,
         (select count(*)::int from jobs j where j.tenant_id=t.id) as jobs
       from tenants t left join vendor_profiles p on p.tenant_id=t.id left join subscriptions s on s.tenant_id=t.id
       left join subscription_periods sp on sp.id=s.current_period_id left join plans pl on pl.id=sp.plan_id
       where t.kind in ('vendor','direct') order by t.created_at desc limit 200`),
    q("select t.name, p.slug from tenants t join vendor_profiles p on p.tenant_id=t.id where t.kind='direct' and t.status='active' limit 1"),
  ]);
  const counts = Object.fromEntries(enq.map(r => [r.status, r.n]));
  const have = new Map(pols.map(p => [p.slug, p]));
  return {
    canEditSettings: actor.role === 'platform_owner',
    enquiryCounts: counts,
    plans: plans.map(p => ({ code: p.code, version: p.version, name: p.name, staffSeats: p.staff_seats, monthlyPricePaise: Number(p.monthly_price_paise) })),
    processingPrice: pricing[0] ? { perMpPaise: Number(pricing[0].per_mp_paise), minPaise: Number(pricing[0].min_paise) } : null,
    policies: POLICY_SLUGS.map(s => { const p = have.get(s); return { slug: s, published: !!p, version: p?.version ?? null, effectiveDate: p?.effective_date ?? null, approvedBy: p?.approved_by_name ?? null }; }),
    directStore: direct[0] ? { name: direct[0].name as string, slug: direct[0].slug as string } : null,
    tenants: tenants.map(t => ({ id: t.id, name: t.name, kind: t.kind, status: t.status, slug: t.slug, subscription: t.subscription, plan: t.plan, jobs: t.jobs, createdAt: new Date(t.created_at).toISOString() })),
  };
}

/** Staff view of the moving parts: the job queue (from the database, which is the truth), the Redis signal channel, and storage settings. */
export async function systemHealth(actor: Actor) {
  if (!STAFF.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  const { queueHealth } = await import('./queue'); const { storage } = await import('./storage');
  const j = (await getPool().query(`select count(*) filter (where status='queued')::int queued, count(*) filter (where status='running')::int running,
    coalesce(extract(epoch from now()-min(created_at) filter (where status='queued'))/60,0)::int oldest_minutes from jobs`)).rows[0];
  let st: { configured: boolean; driver?: string; problem?: string };
  try { st = { configured: true, driver: storage().kind }; } catch (e: any) { st = { configured: false, problem: e.message }; }
  return { jobs: { queued: j.queued as number, running: j.running as number, oldestQueuedMinutes: j.oldest_minutes as number }, redis: await queueHealth(), storage: st };
}
