import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { workOnce, jobStatus, readOutput } from '../src/server/worker';
import { listLibrary } from '../src/server/retention';
import { createTicket, getTicket, listTickets, reply, addNote, assign, escalate, resolve, reopen, close, autoCloseResolved } from '../src/server/support';
import { getPool } from '../src/server/db';

let T: string, P: string; let n = 0;
beforeAll(async () => { await setupDb(); T = await mkTenant('V'); P = await mkTenant('Platform', 'platform'); });
afterAll(closePool);
const S = { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' as const };
const png = () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#26a' } }).png().toBuffer();
async function job(u: Awaited<ReturnType<typeof mkActor>>, drain: boolean) {
  const p = await createProject(u, 'P' + ++n); const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S });
  await fund(T, u.userId, 100000, 'c' + n); await fund(T, null, 1_000_000, 'v' + n);
  const q = await createQuote(u, p.id); const r = await reserveQuote(u, q.quoteId);
  if (drain) while (await workOnce('w')) { /* drain */ }
  return { projectId: p.id, jobId: r.jobId, quoteId: q.quoteId, outputId: drain ? (await jobStatus(u, r.jobId)).outputId! : null };
}
const setup = async () => { const id = ++n; return { cust: await mkActor(T, `c${id}@x.test`), admin: await mkActor(T, `a${id}@x.test`, 'vendor_admin'), counter: await mkActor(T, `k${id}@x.test`, 'vendor_counter'), owner: await mkActor(P, `o${id}@x.test`, 'platform_owner'), support: await mkActor(P, `s${id}@x.test`, 'platform_support') }; };

describe('creating tickets', () => {
  it('links only records the requester can read; others look like "not found"', async () => {
    const a = await setup(); const b = await mkActor(T, `b${++n}@x.test`); const j = await job(a.cust, true);
    for (const [t, id] of [['project', j.projectId], ['job', j.jobId], ['quote', j.quoteId], ['output', j.outputId!]] as const) expect((await createTicket(a.cust, { category: 'file_or_job', subject: 'Help me', body: 'x', linkType: t, linkId: id })).reference).toMatch(/^TKT-\d{6}$/);
    for (const [t, id] of [['project', j.projectId], ['job', j.jobId], ['output', j.outputId!]] as const) await expect(createTicket(b, { category: 'other', subject: 'Not mine', body: 'x', linkType: t, linkId: id })).rejects.toMatchObject({ code: 'not_found' });
    await expect(createTicket(a.cust, { category: 'nope', subject: 'Help me', body: 'x' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(createTicket(a.cust, { category: 'other', subject: 'ab', body: 'x' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(createTicket(a.cust, { category: 'other', subject: 'Help me', body: 'x', linkType: 'project', linkId: 'not-a-uuid' })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('who can see what', () => {
  it('requester: own only, no internal notes; store staff: their tenant; other tenant and platform: nothing until escalation', async () => {
    const a = await setup(); const other = await mkActor(T, `x${++n}@x.test`); const T2 = await mkTenant('V2'); const foreign = await mkActor(T2, `f${n}@x.test`, 'vendor_admin');
    const t = await createTicket(a.cust, { category: 'other', subject: 'Question', body: 'Hello' });
    await addNote(a.admin, t.id, 'Customer seems confused; check the bill');
    const mine = await getTicket(a.cust, t.id); expect(mine.messages.map((m: any) => m.kind)).toEqual(['public']); expect(JSON.stringify(mine)).not.toContain('confused'); expect(mine.assigneeId).toBeUndefined(); expect(mine.assignable).toBeUndefined();
    expect((await getTicket(a.admin, t.id)).messages.map((m: any) => m.kind)).toEqual(['public', 'internal']);
    expect((await getTicket(a.counter, t.id)).viewerRole).toBe('tenant_staff');
    for (const who of [other, foreign, a.owner, a.support]) await expect(getTicket(who, t.id)).rejects.toMatchObject({ code: 'not_found' });
    for (const who of [other, foreign]) await expect(reply(who, t.id, 'hi')).rejects.toMatchObject({ code: 'not_found' });
    await expect(addNote(a.cust, t.id, 'sneaky')).rejects.toMatchObject({ code: 'not_found' });
    expect((await listTickets(other)).some(x => x.id === t.id)).toBe(false); expect((await listTickets(a.admin)).some(x => x.id === t.id)).toBe(true); expect((await listTickets(a.owner)).some(x => x.id === t.id)).toBe(false);
  });
});

describe('support flow (WF-21)', () => {
  it('create, assign, ask for evidence, reply, escalate, resolve with evidence, close; emails agree with state', async () => {
    const a = await setup(); const t = await createTicket(a.cust, { category: 'other', subject: 'Wrong size', body: 'My export is the wrong size' });
    await expect(assign(a.counter, t.id, a.counter.userId)).rejects.toMatchObject({ code: 'denied' }); // only the store admin assigns
    await expect(assign(a.admin, t.id, a.owner.userId)).rejects.toMatchObject({ code: 'invalid' }); // must be store staff
    await assign(a.admin, t.id, a.counter.userId);
    await reply(a.counter, t.id, 'Can you send the size you expected?');
    expect((await getTicket(a.cust, t.id)).status).toBe('awaiting_requester');
    expect((await getPool().query("select count(*)::int n from email_outbox where to_email=$1 and template='ticket_reply'", [`c${n}@x.test`])).rows[0].n).toBe(1);
    await reply(a.cust, t.id, '50 x 30 mm'); expect((await getTicket(a.cust, t.id)).status).toBe('open');
    // escalation: needs a reason and an accountable platform owner
    await expect(escalate(a.counter, t.id, 'short', a.owner.userId)).rejects.toMatchObject({ code: 'reason_required' });
    await expect(escalate(a.counter, t.id, 'Needs platform to check the engine output', a.admin.userId)).rejects.toMatchObject({ code: 'owner_required' });
    await expect(escalate(a.cust, t.id, 'Needs platform to check the engine output', a.owner.userId)).rejects.toMatchObject({ code: 'denied' });
    await escalate(a.counter, t.id, 'Needs platform to check the engine output', a.owner.userId);
    await expect(escalate(a.counter, t.id, 'Needs platform to check the engine output', a.owner.userId)).rejects.toMatchObject({ code: 'already_escalated' });
    const forPlatform = await getTicket(a.owner, t.id); expect(forPlatform.status).toBe('escalated'); expect(forPlatform.assigneeId).toBe(a.owner.userId); expect(forPlatform.messages.some((m: any) => m.kind === 'internal' && m.body.startsWith('Escalated:'))).toBe(true);
    const forCust = await getTicket(a.cust, t.id); expect(JSON.stringify(forCust)).not.toContain('platform to check'); expect(forCust.messages.at(-1).body).toMatch(/escalated to platform support/); expect(forCust.messages.at(-1).from).toBe('system');
    expect((await listTickets(a.owner)).some(x => x.id === t.id)).toBe(true);
    // the store admin can no longer assign; only the platform owner can
    await expect(assign(a.admin, t.id, a.counter.userId)).rejects.toMatchObject({ code: 'denied' }); await assign(a.owner, t.id, a.support.userId);
    // resolution needs the assignee (or owner) and evidence
    await expect(resolve(a.counter, t.id, 'Fixed it', 'Re-ran the export and checked the size')).rejects.toMatchObject({ code: 'denied' });
    await expect(resolve(a.support, t.id, 'Fixed it', 'short')).rejects.toMatchObject({ code: 'evidence_required' });
    await expect(resolve(a.support, t.id, 'x', 'Re-ran the export and checked the size')).rejects.toMatchObject({ code: 'resolution_required' });
    await resolve(a.support, t.id, 'Re-ran the export at the right size', 'Output 591x394 px checked against 50x30 mm at 300 dpi');
    const done = await getTicket(a.cust, t.id); expect(done.status).toBe('resolved'); expect(done.evidence).toContain('591x394'); expect(done.resolution).toContain('right size');
    expect((await getPool().query("select count(*)::int n from email_outbox where template='ticket_resolved' and to_email=$1", [`c${n}@x.test`])).rows[0].n).toBe(1);
    await expect(reply(a.cust, t.id, 'thanks')).rejects.toMatchObject({ code: 'resolved' });
    await expect(close(a.admin, t.id)).rejects.toMatchObject({ code: 'denied' }); await close(a.cust, t.id);
    expect((await getTicket(a.cust, t.id)).status).toBe('closed');
    const audits = (await getPool().query("select action from audit_log where object_id=$1 order by id", [t.id])).rows.map(r => r.action); expect(audits).toEqual(['ticket.create', 'ticket.assign', 'ticket.escalate', 'ticket.assign', 'ticket.resolve', 'ticket.close']);
  });
  it('escalation is not a file permission: platform staff still cannot read the requester\'s files', async () => {
    const a = await setup(); const j = await job(a.cust, true);
    const t = await createTicket(a.cust, { category: 'file_or_job', subject: 'Output looks off', body: 'See job', linkType: 'output', linkId: j.outputId! });
    await escalate(a.counter, t.id, 'Needs platform to look at the output', a.owner.userId);
    expect((await getTicket(a.owner, t.id)).link).toEqual({ type: 'output', id: j.outputId }); // the reference travels...
    await expect(readOutput(a.owner, j.outputId!)).rejects.toMatchObject({ code: 'not_found' }); // ...the file does not
    expect(await listLibrary(a.owner)).toEqual([]);
  });
});

describe('reopen rules', () => {
  it('reopens a resolved ticket up to the limit, and not long after closing', async () => {
    const a = await setup(); const t = await createTicket(a.cust, { category: 'other', subject: 'Reopen me', body: 'x' }); await assign(a.admin, t.id, a.counter.userId);
    await expect(reopen(a.cust, t.id)).rejects.toMatchObject({ code: 'not_resolved' });
    for (let i = 0; i < 3; i++) { await resolve(a.counter, t.id, 'Done once', 'Checked the account settings page'); await reopen(a.cust, t.id); expect((await getTicket(a.cust, t.id)).status).toBe('open'); }
    await resolve(a.counter, t.id, 'Done again', 'Checked the account settings page');
    await expect(reopen(a.cust, t.id)).rejects.toMatchObject({ code: 'reopen_limit' });
    const t2 = await createTicket(a.cust, { category: 'other', subject: 'Old one', body: 'x' }); await assign(a.admin, t2.id, a.counter.userId);
    await resolve(a.counter, t2.id, 'Done here', 'Checked the account settings page'); await close(a.cust, t2.id);
    await getPool().query("update tickets set closed_at=now()-interval '15 days' where id=$1", [t2.id]);
    await expect(reopen(a.cust, t2.id)).rejects.toMatchObject({ code: 'reopen_expired' });
    expect((await getTicket(a.cust, t2.id)).canReopen).toBe(false);
  });
  it('resolved tickets auto-close after a week; safe to rerun', async () => {
    const a = await setup(); const t = await createTicket(a.cust, { category: 'other', subject: 'Auto close', body: 'x' }); await assign(a.admin, t.id, a.counter.userId);
    await resolve(a.counter, t.id, 'Done here', 'Checked the account settings page');
    expect((await autoCloseResolved()).autoClosed).toBe(0);
    await getPool().query("update tickets set resolved_at=now()-interval '8 days' where id=$1", [t.id]);
    expect((await autoCloseResolved()).autoClosed).toBe(1); expect((await autoCloseResolved()).autoClosed).toBe(0); expect((await getTicket(a.cust, t.id)).status).toBe('closed');
  });
});

describe('money truth (AT-30)', () => {
  it('a payment ticket cannot be resolved while the job or hold is unsettled', async () => {
    const a = await setup(); const j = await job(a.cust, false); // reserved, not yet processed
    const t = await createTicket(a.cust, { category: 'payment', subject: 'Charged but nothing', body: 'Where is my file', linkType: 'job', linkId: j.jobId }); await assign(a.admin, t.id, a.counter.userId);
    await expect(resolve(a.counter, t.id, 'Looked into it', 'Checked the ledger and the job queue')).rejects.toMatchObject({ code: 'financial_unresolved' });
    expect((await getTicket(a.cust, t.id)).status).toBe('open');
    while (await workOnce('w')) { /* settle */ }
    await resolve(a.counter, t.id, 'Job completed and charged once', 'Ledger shows one capture; output validated');
    expect((await getTicket(a.cust, t.id)).status).toBe('resolved');
  });
  it('a non-payment ticket is not blocked by an unrelated running job', async () => {
    const a = await setup(); await job(a.cust, false); const t = await createTicket(a.cust, { category: 'account', subject: 'Change email', body: 'x' }); await assign(a.admin, t.id, a.counter.userId);
    await resolve(a.counter, t.id, 'Explained how', 'Pointed to the account settings page'); while (await workOnce('w')) { /* tidy */ }
  });
});
