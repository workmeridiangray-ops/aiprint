import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { canReadProject } from './org';

const TENANT_STAFF = ['vendor_admin', 'vendor_counter'];
const PLATFORM_STAFF = ['platform_owner', 'platform_support'];
const CATEGORIES = ['file_or_job', 'payment', 'account', 'deletion', 'other'] as const;
const LINKS = ['project', 'job', 'output', 'quote'] as const;
const REOPEN_DAYS = 14, REOPEN_MAX = 3, AUTOCLOSE_DAYS = 7;
const ACTIVE_JOB = "('awaiting_funds','reserved','queued','running','cancellation_requested')";

type C = { query: (sql: string, p?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }> };
const audit = (c: C, a: { actor: string; tenant: string | null; action: string; id: string; outcome: string }) =>
  c.query('insert into audit_log(actor_user_id,tenant_id,action,object_type,object_id,outcome) values($1,$2,$3,$4,$5,$6)', [a.actor, a.tenant, a.action, 'ticket', a.id, a.outcome.slice(0, 200)]);
const isPlatform = (a: Actor) => PLATFORM_STAFF.includes(a.role);
const isTenantStaff = (a: Actor) => TENANT_STAFF.includes(a.role);

/** The requester may only link a record they can already read. Anything else is "not found", never "forbidden". */
async function resolveLink(c: C, actor: Actor, type: string, id: string): Promise<{ quoteId: string | null; projectId: string }> {
  const sql: Record<string, string> = {
    project: 'select p.*, null::uuid as quote_id from projects p where p.id=$1',
    quote: 'select p.*, q.id as quote_id from quotes q join projects p on p.id=q.project_id where q.id=$1',
    job: 'select p.*, q.id as quote_id from jobs j join reservations r on r.id=j.reservation_id join quotes q on q.id=r.quote_id join projects p on p.id=q.project_id where j.id=$1',
    output: 'select p.*, q.id as quote_id from outputs o join jobs j on j.id=o.job_id join reservations r on r.id=j.reservation_id join quotes q on q.id=r.quote_id join projects p on p.id=q.project_id where o.id=$1',
  };
  const r = await c.query(sql[type], [id]); const p = r.rows[0];
  if (!p || !(await canReadProject(c as any, actor, p))) throw new AppError('not_found', 'That record was not found', 404);
  return { quoteId: p.quote_id, projectId: p.id };
}

/* ---------- create / read ---------- */
export async function createTicket(actor: Actor, i: { category: string; subject: string; body: string; linkType?: string | null; linkId?: string | null }) {
  if (!(CATEGORIES as readonly string[]).includes(i.category)) throw new AppError('invalid', 'Choose a category');
  if (String(i.subject ?? '').trim().length < 3 || String(i.subject).trim().length > 150) throw new AppError('invalid', 'Give a short subject (3 to 150 characters)');
  if (String(i.body ?? '').trim().length < 1 || String(i.body).length > 5000) throw new AppError('invalid', 'Describe the problem (up to 5000 characters)');
  const linked = !!i.linkType || !!i.linkId;
  if (linked && !((LINKS as readonly string[]).includes(String(i.linkType)) && /^[0-9a-f-]{36}$/i.test(String(i.linkId)))) throw new AppError('invalid', 'The linked record is not valid');
  return tx(async c => {
    if (linked) await resolveLink(c, actor, i.linkType!, i.linkId!);
    const t = (await c.query('insert into tickets(tenant_id,requester_id,category,subject,link_type,link_id) values($1,$2,$3,$4,$5,$6) returning id,reference',
      [actor.tenantId, actor.userId, i.category, i.subject.trim(), linked ? i.linkType : null, linked ? i.linkId : null])).rows[0];
    await c.query("insert into ticket_messages(ticket_id,author_id,kind,body) values($1,$2,'public',$3)", [t.id, actor.userId, i.body.trim()]);
    await audit(c, { actor: actor.userId, tenant: actor.tenantId, action: 'ticket.create', id: t.id, outcome: i.category });
    return { id: t.id as string, reference: t.reference as string };
  });
}

type T = any;
async function load(c: C, id: string, lock = false): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('not_found', 'Ticket not found', 404);
  const t = (await c.query(`select * from tickets where id=$1${lock ? ' for update' : ''}`, [id])).rows[0];
  return t;
}
/** Staff scope: tenant staff of the ticket's tenant, or platform staff once it is escalated. Requesters see only their own. */
const role = (a: Actor, t: T): 'requester' | 'tenant_staff' | 'platform_staff' | null =>
  t.requester_id === a.userId ? 'requester'
  : isTenantStaff(a) && t.tenant_id === a.tenantId ? 'tenant_staff'
  : isPlatform(a) && t.escalated_at ? 'platform_staff' : null;
const must = (a: Actor, t: T) => { const r = t ? role(a, t) : null; if (!r) throw new AppError('not_found', 'Ticket not found', 404); return r; };

export async function listTickets(actor: Actor, status?: string) {
  const [where, args]: [string, unknown[]] = isPlatform(actor) ? ['escalated_at is not null', []] : isTenantStaff(actor) ? ['tenant_id=$1', [actor.tenantId]] : ['requester_id=$1', [actor.userId]];
  const n = args.length; let f = ''; if (status) { args.push(status); f = ` and status=$${n + 1}`; }
  args.push(actor.userId);
  const r = await getPool().query(`select id,reference,subject,category,status,created_at,updated_at,(requester_id=$${args.length}) as mine,assignee_id is not null as assigned from tickets where ${where}${f} order by updated_at desc limit 200`, args);
  return r.rows.map(t => ({ id: t.id as string, reference: t.reference as string, subject: t.subject as string, category: t.category as string, status: t.status as string, mine: t.mine as boolean, assigned: t.assigned as boolean, createdAt: new Date(t.created_at).toISOString(), updatedAt: new Date(t.updated_at).toISOString() }));
}

export async function getTicket(actor: Actor, id: string) {
  const p = getPool(); const t = await load(p as any, id); const r = must(actor, t); const staff = r !== 'requester';
  const msgs = (await p.query(`select m.id,m.kind,m.body,m.created_at,m.author_id,u.email from ticket_messages m left join users u on u.id=m.author_id where m.ticket_id=$1 ${staff ? '' : "and m.kind='public'"} order by m.id`, [id])).rows;
  const out: any = {
    id: t.id, reference: t.reference, subject: t.subject, category: t.category, status: t.status, createdAt: new Date(t.created_at).toISOString(), updatedAt: new Date(t.updated_at).toISOString(),
    link: t.link_type ? { type: t.link_type, id: t.link_id } : null, escalated: !!t.escalated_at, assigned: !!t.assignee_id,
    resolution: t.resolution, evidence: t.resolution_evidence, resolvedAt: t.resolved_at ? new Date(t.resolved_at).toISOString() : null, reopenCount: t.reopen_count, canReopen: canReopen(t), viewerRole: r,
    messages: msgs.map(m => ({ id: Number(m.id), kind: m.kind, body: m.body, at: new Date(m.created_at).toISOString(), from: !m.author_id ? 'system' : m.author_id === t.requester_id ? (r === 'requester' ? 'you' : 'requester') : (staff ? m.email : 'support') })),
  };
  if (staff) {
    out.assigneeId = t.assignee_id; out.escalationReason = t.escalation_reason; out.escalatedTo = t.escalated_to; out.requesterEmail = (await p.query('select email from users where id=$1', [t.requester_id])).rows[0]?.email;
    out.assignable = await assignable(p as any, actor, t);
    if (r === 'tenant_staff' && !t.escalated_at) out.owners = (await p.query(`select distinct u.id,u.email from memberships m join users u on u.id=m.user_id where m.role = any($1) and m.revoked_at is null and u.status='active' order by u.email`, [PLATFORM_STAFF])).rows;
  }
  return out;
}
const canReopen = (t: T) => ['resolved', 'closed'].includes(t.status) && t.reopen_count < REOPEN_MAX && (t.status === 'resolved' || (t.closed_at && Date.now() - new Date(t.closed_at).getTime() <= REOPEN_DAYS * 86400000));
async function assignable(c: C, actor: Actor, t: T) {
  if (isPlatform(actor)) return (await c.query(`select distinct u.id,u.email from memberships m join users u on u.id=m.user_id where m.role = any($1) and m.revoked_at is null and u.status='active' order by u.email`, [PLATFORM_STAFF])).rows;
  return (await c.query(`select distinct u.id,u.email from memberships m join users u on u.id=m.user_id where m.tenant_id=$1 and m.role = any($2) and m.revoked_at is null and u.status='active' order by u.email`, [t.tenant_id, TENANT_STAFF])).rows;
}

/* ---------- conversation ---------- */
const notify = (c: C, requesterId: string, template: string, ref: string) =>
  c.query("insert into email_outbox(to_email,template,body) select email,$2,$3 from users where id=$1 and status='active'", [requesterId, template, JSON.stringify({ reference: ref })]);
const touch = (c: C, id: string, status?: string) => c.query('update tickets set updated_at=now()' + (status ? ', status=$2' : '') + ' where id=$1', status ? [id, status] : [id]);
const body = (b: string) => { const s = String(b ?? '').trim(); if (!s || s.length > 5000) throw new AppError('invalid', 'Write a message (up to 5000 characters)'); return s; };

/** Public reply. A staff reply that asks for information puts the ticket with the requester; the requester's reply puts it back with staff. */
export async function reply(actor: Actor, id: string, text: string) {
  return tx(async c => {
    const t = await load(c, id, true); const r = must(actor, t); const b = body(text);
    if (t.status === 'closed') throw new AppError('closed', 'This ticket is closed. Reopen it to continue.', 409);
    if (t.status === 'resolved') throw new AppError('resolved', 'This ticket is resolved. Reopen it to continue.', 409);
    await c.query("insert into ticket_messages(ticket_id,author_id,kind,body) values($1,$2,'public',$3)", [id, actor.userId, b]);
    if (r === 'requester') await touch(c, id, t.escalated_at ? 'escalated' : 'open');
    else { await touch(c, id, t.escalated_at ? 'escalated' : 'awaiting_requester'); await notify(c, t.requester_id, 'ticket_reply', t.reference); }
  });
}
export async function addNote(actor: Actor, id: string, text: string) {
  return tx(async c => {
    const t = await load(c, id, true); const r = must(actor, t); if (r === 'requester') throw new AppError('not_found', 'Ticket not found', 404);
    await c.query("insert into ticket_messages(ticket_id,author_id,kind,body) values($1,$2,'internal',$3)", [id, actor.userId, body(text)]); await touch(c, id);
  });
}

/* ---------- ownership ---------- */
export async function assign(actor: Actor, id: string, assigneeId: string) {
  return tx(async c => {
    const t = await load(c, id, true); const r = must(actor, t);
    if (r === 'requester') throw new AppError('not_found', 'Ticket not found', 404);
    if (['resolved', 'closed'].includes(t.status)) throw new AppError('closed', 'Reopen the ticket before assigning it', 409);
    const allowed = r === 'platform_staff' ? actor.role === 'platform_owner' : actor.role === 'vendor_admin' && !t.escalated_at;
    if (!allowed) throw new AppError('denied', 'You cannot assign this ticket', 403);
    if (!(await assignable(c, actor, t)).some((x: any) => x.id === assigneeId)) throw new AppError('invalid', 'Choose someone who can handle this ticket');
    await c.query('update tickets set assignee_id=$2, updated_at=now() where id=$1', [id, assigneeId]);
    await audit(c, { actor: actor.userId, tenant: t.tenant_id, action: 'ticket.assign', id, outcome: 'ok' });
  });
}
/** Escalation names an accountable platform owner of the next step. It shares the ticket, never the customer's files. */
export async function escalate(actor: Actor, id: string, reason: string, ownerId: string) {
  return tx(async c => {
    const t = await load(c, id, true); const r = must(actor, t);
    if (r !== 'tenant_staff') throw new AppError('denied', 'Only the store support team can escalate', 403);
    if (['resolved', 'closed'].includes(t.status)) throw new AppError('closed', 'Reopen the ticket before escalating it', 409);
    if (t.escalated_at) throw new AppError('already_escalated', 'This ticket is already escalated', 409);
    if (String(reason ?? '').trim().length < 10) throw new AppError('reason_required', 'Explain why this needs platform support (at least 10 characters)');
    const owner = await c.query(`select 1 from memberships m join users u on u.id=m.user_id where m.user_id=$1 and m.role = any($2) and m.revoked_at is null and u.status='active'`, [ownerId, PLATFORM_STAFF]);
    if (!owner.rowCount) throw new AppError('owner_required', 'Choose the platform person who will own the next step');
    await c.query("update tickets set status='escalated', escalated_at=now(), escalated_by=$2, escalated_to=$3, assignee_id=$3, escalation_reason=$4, updated_at=now() where id=$1", [id, actor.userId, ownerId, reason.trim()]);
    await c.query("insert into ticket_messages(ticket_id,author_id,kind,body) values($1,$2,'internal',$3)", [id, actor.userId, 'Escalated: ' + reason.trim()]);
    await c.query("insert into ticket_messages(ticket_id,author_id,kind,body) values($1,null,'public','This ticket was escalated to platform support for further review.')", [id]);
    await audit(c, { actor: actor.userId, tenant: t.tenant_id, action: 'ticket.escalate', id, outcome: 'to ' + ownerId });
  });
}

/* ---------- resolution ---------- */
async function unresolvedMoney(c: C, t: T): Promise<boolean> {
  if (!t.link_type) return false;
  const l = await c.query({ project: 'select null::uuid quote_id, p.id project_id from projects p where p.id=$1', quote: 'select q.id quote_id, q.project_id from quotes q where q.id=$1',
    job: 'select q.id quote_id, q.project_id from jobs j join reservations r on r.id=j.reservation_id join quotes q on q.id=r.quote_id where j.id=$1',
    output: 'select q.id quote_id, q.project_id from outputs o join jobs j on j.id=o.job_id join reservations r on r.id=j.reservation_id join quotes q on q.id=r.quote_id where o.id=$1' }[t.link_type as string]!, [t.link_id]);
  if (!l.rowCount) return false;
  const r = await c.query(`select exists (select 1 from reservations rs join quotes q on q.id=rs.quote_id left join jobs j on j.reservation_id=rs.id
    where q.project_id=$1 and ($2::uuid is null or q.id=$2) and (rs.status='held' or j.status in ${ACTIVE_JOB})) as open`, [l.rows[0].project_id, l.rows[0].quote_id]);
  return r.rows[0].open;
}
/** Resolution needs evidence, and a payment ticket cannot be resolved while the money it concerns is still held or a job is still running. */
export async function resolve(actor: Actor, id: string, resolution: string, evidence: string) {
  return tx(async c => {
    const t = await load(c, id, true); const r = must(actor, t);
    if (r === 'requester') throw new AppError('not_found', 'Ticket not found', 404);
    const allowed = t.assignee_id === actor.userId || (r === 'platform_staff' ? actor.role === 'platform_owner' : actor.role === 'vendor_admin' && !t.escalated_at);
    if (!allowed) throw new AppError('denied', 'Only the assigned person or an administrator can resolve this ticket', 403);
    if (['resolved', 'closed'].includes(t.status)) throw new AppError('closed', 'Already resolved', 409);
    if (String(resolution ?? '').trim().length < 5) throw new AppError('resolution_required', 'State what was done');
    if (String(evidence ?? '').trim().length < 10) throw new AppError('evidence_required', 'Record the evidence for the resolution (a reference, a result, what you checked)');
    if (t.category === 'payment' && await unresolvedMoney(c, t)) throw new AppError('financial_unresolved', 'The money or job this ticket concerns is not settled yet. Resolve the payment first; a ticket cannot be closed to hide it.', 409);
    await c.query("update tickets set status='resolved', resolution=$2, resolution_evidence=$3, resolved_by=$4, resolved_at=now(), updated_at=now() where id=$1", [id, resolution.trim(), evidence.trim(), actor.userId]);
    await c.query("insert into ticket_messages(ticket_id,author_id,kind,body) values($1,null,'public',$2)", [id, 'Resolved: ' + resolution.trim()]);
    await notify(c, t.requester_id, 'ticket_resolved', t.reference);
    await audit(c, { actor: actor.userId, tenant: t.tenant_id, action: 'ticket.resolve', id, outcome: 'ok' });
  });
}
export async function reopen(actor: Actor, id: string) {
  return tx(async c => {
    const t = await load(c, id, true); must(actor, t);
    if (!['resolved', 'closed'].includes(t.status)) throw new AppError('not_resolved', 'This ticket is still open', 409);
    if (t.reopen_count >= REOPEN_MAX) throw new AppError('reopen_limit', 'This ticket was reopened too many times. Open a new ticket and mention this reference.', 409);
    if (t.status === 'closed' && Date.now() - new Date(t.closed_at).getTime() > REOPEN_DAYS * 86400000) throw new AppError('reopen_expired', `Tickets can be reopened for ${REOPEN_DAYS} days after closing. Open a new ticket and mention ${t.reference}.`, 409);
    await c.query("update tickets set status=$2, reopen_count=reopen_count+1, closed_at=null, resolved_at=null, updated_at=now() where id=$1", [id, t.escalated_at ? 'escalated' : 'open']);
    await c.query("insert into ticket_messages(ticket_id,author_id,kind,body) values($1,null,'public','This ticket was reopened.')", [id]);
    await audit(c, { actor: actor.userId, tenant: t.tenant_id, action: 'ticket.reopen', id, outcome: 'ok' });
  });
}
/** The requester confirms a resolved ticket is done. */
export async function close(actor: Actor, id: string) {
  return tx(async c => {
    const t = await load(c, id, true); const r = must(actor, t);
    if (r !== 'requester') throw new AppError('denied', 'Only the person who opened the ticket can close it', 403);
    if (t.status !== 'resolved') throw new AppError('not_resolved', 'Only a resolved ticket can be closed', 409);
    await c.query("update tickets set status='closed', closed_at=now(), updated_at=now() where id=$1", [id]);
    await audit(c, { actor: actor.userId, tenant: t.tenant_id, action: 'ticket.close', id, outcome: 'requester' });
  });
}
/** Scheduled. Closes tickets that stayed resolved for a week. Safe to rerun. */
export async function autoCloseResolved(now = new Date()) {
  const r = await getPool().query(`update tickets set status='closed', closed_at=$1, updated_at=$1 where status='resolved' and resolved_at <= $1::timestamptz - interval '${AUTOCLOSE_DAYS} days' returning id`, [now]);
  return { autoClosed: r.rowCount ?? 0 };
}
