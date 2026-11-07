import { createHash, randomBytes } from 'node:crypto';
import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { audit } from './identity';

const need = (a: Actor, roles: string[]) => { if (!roles.includes(a.role)) throw new AppError('denied', 'Not permitted', 403); };
export const CONSENT_TEXT_VERSION = 'enquiry-consent-v1';
export const POLICY_SLUGS = ['terms', 'privacy', 'refund', 'acceptable_use'] as const;
export type PolicySlug = (typeof POLICY_SLUGS)[number];

/* ---------- public catalogue (reads real records only) ---------- */
export async function listPlans() {
  const r = await getPool().query(`select distinct on (code) id, code, version, name, staff_seats, monthly_price_paise from plans order by code, version desc`);
  return r.rows.map(p => ({ id: p.id as string, code: p.code as string, name: p.name as string, staffSeats: p.staff_seats as number, monthlyPricePaise: Number(p.monthly_price_paise) }))
    .sort((a, b) => a.monthlyPricePaise - b.monthlyPricePaise);
}
/** Retail price of the owner-operated direct store, if it has been set. No vendor cost or margin is exposed. */
export async function directPricing() {
  const r = await getPool().query(`select vp.per_mp_paise, vp.min_paise, p.slug from tenants t join vendor_profiles p on p.tenant_id=t.id join vendor_pricing vp on vp.tenant_id=t.id
    where t.kind='direct' and t.status='active' order by vp.created_at desc, vp.id desc limit 1`);
  return r.rowCount ? { perMpPaise: Number(r.rows[0].per_mp_paise), minPaise: Number(r.rows[0].min_paise), slug: r.rows[0].slug as string } : null;
}
export async function directStoreSlug() {
  const r = await getPool().query("select p.slug from tenants t join vendor_profiles p on p.tenant_id=t.id where t.kind='direct' and t.status='active' limit 1");
  return (r.rows[0]?.slug as string | undefined) ?? null;
}
export async function createDirectStore(actor: Actor, name: string, slug: string) {
  need(actor, ['platform_owner']);
  if (!name.trim()) throw new AppError('invalid_name', 'Name is required');
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) throw new AppError('invalid_slug', 'Web address must be 3-40 letters, numbers or hyphens');
  return tx(async c => {
    if ((await c.query("select 1 from tenants where kind='direct' and status<>'closed'")).rowCount) throw new AppError('exists', 'A direct store already exists', 409);
    if ((await c.query('select 1 from vendor_profiles where slug=$1', [slug])).rowCount) throw new AppError('slug_taken', 'That web address is taken', 409);
    const t = await c.query("insert into tenants(kind,name,status) values('direct',$1,'active') returning id", [name.trim()]);
    await c.query('insert into vendor_profiles(tenant_id,display_name,slug) values($1,$2,$3)', [t.rows[0].id, name.trim(), slug]);
    await audit(c, { actor: actor.userId, tenant: t.rows[0].id, action: 'direct_store.create', outcome: 'ok' });
    return { tenantId: t.rows[0].id as string };
  });
}

/* ---------- policies ---------- */
export async function getPolicy(slug: string) {
  if (!(POLICY_SLUGS as readonly string[]).includes(slug)) return null;
  const r = await getPool().query('select version, effective_date::text as effective_date, body from policies where slug=$1 order by version desc limit 1', [slug]);
  return r.rowCount ? { version: r.rows[0].version as number, effectiveDate: r.rows[0].effective_date as string, body: r.rows[0].body as string } : null;
}
export async function publishPolicy(actor: Actor, p: { slug: string; effectiveDate: string; body: string; approvedByName: string }) {
  need(actor, ['platform_owner']);
  if (!(POLICY_SLUGS as readonly string[]).includes(p.slug)) throw new AppError('invalid_policy', 'Unknown policy');
  if (!p.body.trim()) throw new AppError('invalid_body', 'Policy text is required');
  if (!p.approvedByName.trim()) throw new AppError('approver_required', 'Name the person or body who approved this text');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.effectiveDate) || Number.isNaN(Date.parse(p.effectiveDate))) throw new AppError('invalid_date', 'Effective date must be YYYY-MM-DD');
  return tx(async c => {
    const v = await c.query('select coalesce(max(version),0)+1 as v from policies where slug=$1', [p.slug]);
    await c.query('insert into policies(slug,version,effective_date,body,approved_by_name,published_by) values($1,$2,$3,$4,$5,$6)', [p.slug, v.rows[0].v, p.effectiveDate, p.body, p.approvedByName.trim(), actor.userId]);
    await audit(c, { actor: actor.userId, action: 'policy.publish', type: 'policy', id: `${p.slug}@${v.rows[0].v}`, outcome: 'ok' });
    return { version: v.rows[0].v as number };
  });
}

/* ---------- enquiries ---------- */
export const ENQUIRY_LIMITS = { perSourcePerHour: 5, perEmailPerDay: 3, messageMax: 4000 };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hashSource = (s: string) => createHash('sha256').update((process.env.ENQUIRY_HASH_SALT ?? 'dev-only-salt') + s).digest('hex');
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

/** Public submit. Honeypot hits get the normal acknowledgement and store nothing (bots learn nothing). No attachments in the base enquiry. */
export async function submitEnquiry(input: { name?: unknown; email?: unknown; subject?: unknown; message?: unknown; consent?: unknown; website?: unknown }, source: string) {
  if (clean(input.website, 100)) return { reference: 'ENQ-' + randomBytes(4).toString('hex').toUpperCase(), acknowledged: true as const };
  const name = clean(input.name, 120), email = clean(input.email, 200), subject = clean(input.subject, 160), message = clean(input.message, ENQUIRY_LIMITS.messageMax + 1);
  const errors: Record<string, string> = {};
  if (!name) errors.name = 'Enter your name';
  if (!EMAIL.test(email)) errors.email = 'Enter a valid email address';
  if (!subject) errors.subject = 'Enter a subject';
  if (!message) errors.message = 'Enter a message'; else if (message.length > ENQUIRY_LIMITS.messageMax) errors.message = `Keep the message under ${ENQUIRY_LIMITS.messageMax} characters`;
  if (input.consent !== true) errors.consent = 'Please agree so we can reply to you';
  if (Object.keys(errors).length) throw Object.assign(new AppError('validation', 'Please correct the highlighted fields', 422), { fields: errors });
  const h = hashSource(source);
  return tx(async c => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [h]); // serialise per source so concurrent bursts cannot exceed the limit
    const a = await c.query("select count(*)::int n from enquiries where source_hash=$1 and created_at > now() - interval '1 hour'", [h]);
    const b = await c.query("select count(*)::int n from enquiries where lower(email)=lower($1) and created_at > now() - interval '1 day'", [email]);
    if (a.rows[0].n >= ENQUIRY_LIMITS.perSourcePerHour || b.rows[0].n >= ENQUIRY_LIMITS.perEmailPerDay) throw new AppError('rate_limited', 'Too many enquiries. Please try again later.', 429);
    const ref = 'ENQ-' + randomBytes(4).toString('hex').toUpperCase();
    await c.query('insert into enquiries(reference,name,email,subject,message,consent,consent_text_version,source_hash) values($1,$2,$3,$4,$5,true,$6,$7)', [ref, name, email, subject, message, CONSENT_TEXT_VERSION, h]);
    await c.query("insert into email_outbox(to_email,template,body) values($1,'enquiry_ack',$2)", [email, JSON.stringify({ reference: ref })]);
    return { reference: ref, acknowledged: true as const };
  });
}
const STAFF = ['platform_owner', 'platform_support'];
export async function listEnquiries(actor: Actor, status?: string) {
  need(actor, STAFF);
  const r = await getPool().query(`select id, reference, name, email, subject, message, status, resolution, created_at, closed_at from enquiries ${status ? 'where status=$1' : ''} order by created_at desc limit 100`, status ? [status] : []);
  return r.rows;
}
/** Closing needs a resolution note. Closed enquiries stay closed (reopen is a deliberate transition back to in_progress with audit). */
export async function updateEnquiry(actor: Actor, id: string, patch: { status: 'in_progress' | 'closed'; resolution?: string }) {
  need(actor, STAFF);
  return tx(async c => {
    const r = await c.query('select status from enquiries where id=$1 for update', [id]);
    if (!r.rowCount) throw new AppError('not_found', 'Enquiry not found', 404);
    if (patch.status === 'closed') {
      if (!patch.resolution || patch.resolution.trim().length < 3) throw new AppError('resolution_required', 'Add a short note on how this was resolved');
      if (r.rows[0].status === 'closed') throw new AppError('invalid_transition', 'Already closed', 409);
      await c.query("update enquiries set status='closed', resolution=$2, closed_by=$3, closed_at=now() where id=$1", [id, patch.resolution.trim(), actor.userId]);
    } else if (patch.status === 'in_progress') {
      await c.query("update enquiries set status='in_progress', assigned_to=$2, resolution=null, closed_by=null, closed_at=null where id=$1", [id, actor.userId]);
    } else throw new AppError('invalid_status', 'Unknown status');
    await audit(c, { actor: actor.userId, action: `enquiry.${patch.status}`, type: 'enquiry', id, outcome: 'ok' });
  });
}
