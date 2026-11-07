import { getPool, AppError } from './db';
import type { Actor } from './auth';
import { POLICY_SLUGS } from './public';
import { audit } from './identity';

const STAFF = ['platform_owner', 'platform_support'];
/** Read-only operations overview for platform staff. Contains no customer artwork, files, balances or policy bodies. Owner-only settings are marked so the UI can hide edit forms from support. */
export async function adminOverview(actor: Actor) {
  if (!STAFF.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  const q = (s: string, a: unknown[] = []) => getPool().query(s, a).then(r => r.rows);
  const [enq, plans, pricing, pols, tenants, direct] = await Promise.all([
    q("select status, count(*)::int n from enquiries group by status"),
    q("select distinct on (code) code, version, name, staff_seats, monthly_price_paise, storage_mb from plans order by code, version desc"),
    q("select per_mp_paise, min_paise, created_at from platform_pricing order by created_at desc, id desc limit 1"),
    q("select distinct on (slug) slug, version, effective_date::text as effective_date, approved_by_name from policies order by slug, version desc"),
    q(`select t.id, t.name, t.kind, t.status, t.created_at, p.slug, s.status as subscription, pl.name as plan,
         (select count(*)::int from jobs j where j.tenant_id=t.id) as jobs,
         (select coalesce(sum(bytes),0)::bigint from stored_files f where f.tenant_id=t.id and f.deleted_at is null) as used_bytes, pl.storage_mb
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
    plans: plans.map(p => ({ code: p.code, version: p.version, name: p.name, staffSeats: p.staff_seats, monthlyPricePaise: Number(p.monthly_price_paise), storageMb: p.storage_mb as number | null })),
    processingPrice: pricing[0] ? { perMpPaise: Number(pricing[0].per_mp_paise), minPaise: Number(pricing[0].min_paise) } : null,
    policies: POLICY_SLUGS.map(s => { const p = have.get(s); return { slug: s, published: !!p, version: p?.version ?? null, effectiveDate: p?.effective_date ?? null, approvedBy: p?.approved_by_name ?? null }; }),
    directStore: direct[0] ? { name: direct[0].name as string, slug: direct[0].slug as string } : null,
    tenants: tenants.map(t => ({ id: t.id, name: t.name, kind: t.kind, status: t.status, slug: t.slug, subscription: t.subscription, plan: t.plan, jobs: t.jobs, storageUsedBytes: Number(t.used_bytes), storageQuotaBytes: t.kind === 'vendor' && t.storage_mb ? Number(t.storage_mb) * 1048576 : null, createdAt: new Date(t.created_at).toISOString() })),
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

/** Staff view of jobs needing attention (BE-03 / SC-062). Metadata only: no artwork, project names, balances or customer contact details. */
export async function jobProblems(actor: Actor) {
  if (!STAFF.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  const q = (sql: string) => getPool().query(sql).then(r => r.rows);
  const failed = await q(`select j.id, t.name as tenant, j.attempts, j.last_error, j.finished_at from jobs j join tenants t on t.id=j.tenant_id
    where j.status='failed' and j.finished_at > now() - interval '14 days' order by j.finished_at desc limit 50`);
  const stuck = await q(`select j.id, t.name as tenant, j.attempts, j.lease_owner, j.lease_expires_at from jobs j join tenants t on t.id=j.tenant_id
    where j.status='running' and j.lease_expires_at < now() order by j.lease_expires_at limit 50`);
  const waiting = await q(`select j.id, t.name as tenant, j.created_at, extract(epoch from now()-j.created_at)::int as age_seconds from jobs j join tenants t on t.id=j.tenant_id
    where j.status='queued' order by j.created_at limit 20`);
  const expired = (await q(`select count(*)::int n from jobs where status='cancelled' and last_error like 'Not started in time%'`))[0].n as number;
  return { failed, stuck, waiting, holdsExpired: expired };
}

export type AuditQuery = { action?: string; tenantId?: string; outcome?: string; from?: string; to?: string; before?: number; limit?: number };
/** SC-070: staff audit search. Newest first, keyset pagination by id. Searching is itself audited. Only the owner sees actor email addresses; support sees user ids. */
export async function searchAudit(actor: Actor, f: AuditQuery) {
  if (!STAFF.includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  const where: string[] = []; const args: unknown[] = []; const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', '$' + args.length)); };
  if (f.action) { if (!/^[a-z0-9_.-]{1,60}$/i.test(f.action)) throw new AppError('invalid_filter', 'Action may contain letters, digits, dot, dash and underscore', 400); add("a.action like ?", f.action.replace(/[%_\\]/g, m => '\\' + m) + '%'); }
  if (f.tenantId) { if (!/^[0-9a-f-]{36}$/i.test(f.tenantId)) throw new AppError('invalid_filter', 'Invalid store id', 400); add('a.tenant_id = ?', f.tenantId); }
  if (f.outcome) { if (!/^[a-z0-9_.-]{1,40}$/i.test(f.outcome)) throw new AppError('invalid_filter', 'Invalid outcome', 400); add('a.outcome = ?', f.outcome); }
  for (const [k, sql] of [['from', 'a.at >= ?'], ['to', 'a.at < ?']] as const) { const v = f[k]; if (v) { if (Number.isNaN(Date.parse(v))) throw new AppError('invalid_filter', `Invalid ${k} date`, 400); add(sql, new Date(v).toISOString()); } }
  if (f.before !== undefined) { if (!Number.isInteger(f.before) || f.before < 1) throw new AppError('invalid_filter', 'Invalid page marker', 400); add('a.id < ?', f.before); }
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  args.push(limit + 1);
  const r = await getPool().query(`select a.id, a.at, a.action, a.object_type, a.object_id, a.outcome, a.correlation_id, a.tenant_id, t.name as tenant, a.actor_user_id, u.email as actor_email
    from audit_log a left join tenants t on t.id=a.tenant_id left join users u on u.id=a.actor_user_id ${where.length ? 'where ' + where.join(' and ') : ''} order by a.id desc limit $${args.length}`, args);
  const rows = r.rows.slice(0, limit);
  await audit(getPool(), { actor: actor.userId, tenant: actor.tenantId, action: 'audit.search', outcome: 'ok' });
  return {
    rows: rows.map(x => ({ id: Number(x.id), at: new Date(x.at).toISOString(), action: x.action as string, objectType: x.object_type as string | null, objectId: x.object_id as string | null, outcome: x.outcome as string, correlationId: x.correlation_id as string | null,
      tenant: x.tenant as string | null, actor: x.actor_user_id ? (actor.role === 'platform_owner' ? (x.actor_email as string | null) ?? x.actor_user_id : (x.actor_user_id as string).slice(0, 8)) : null })),
    nextBefore: r.rows.length > limit ? Number(rows[rows.length - 1].id) : null,
  };
}
