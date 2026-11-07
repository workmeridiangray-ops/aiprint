import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { setupDb, mkTenant, mkActor, closePool } from './helpers';
import * as O from '../src/server/org';
import { createProject, saveProject, getProject } from '../src/server/projects';
import { saveOriginal, readOriginal } from '../src/server/files';
import { createQuote, reserveQuote, cancelBeforeDispatch } from '../src/server/quotes';
import { workOnce, jobStatus, readOutput } from '../src/server/worker';
import { ensureOrgAccount, postEntry, balance } from '../src/server/ledger';
import { fund } from './helpers';
import { getPool } from '../src/server/db';
import { csvCell } from '../src/lib/csv';

let T: string;
beforeAll(async () => { await setupDb(); T = await mkTenant('Store'); await fund(T, null, 100_000_000, 'v-big'); });
afterAll(closePool);
const png = () => sharp({ create: { width: 200, height: 200, channels: 3, background: '#a33' } }).png().toBuffer();
const S = { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' as const };

async function org(tag: string, extraMembers = 1) {
  const admin = await mkActor(T, `admin-${tag}@b.test`); const { id } = await O.createOrganisation(admin, `Org ${tag}`);
  const members = [] as any[];
  for (let i = 0; i < extraMembers; i++) { const m = await mkActor(T, `m${i}-${tag}@b.test`); await O.inviteMember(admin, id, `m${i}-${tag}@b.test`); await O.acceptInvite(m, await tokenFor(`m${i}-${tag}@b.test`)); members.push(m); }
  const account = await ensureOrgAccount(getPool(), T, id);
  return { admin, id, members, account };
}
const tokenFor = async (email: string) => JSON.parse((await getPool().query("select body from email_outbox where to_email=$1 and template='org_invite' order by id desc limit 1", [email])).rows[0].body).token as string;
async function orgQuote(u: any, orgId: string) {
  const p = await createProject(u, 'Job', orgId); const f = await saveOriginal(u, await png());
  await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S }); return { pid: p.id, q: await createQuote(u, p.id) };
}
async function drain() { while (await workOnce('w')); }
const fundOrg = (acc: string, paise: number, key: string) => postEntry(getPool(), acc, paise, 'test_seed', key);

describe('membership', () => {
  it('creates an organisation with one admin; one organisation per customer admin; non-customers refused', async () => {
    const a = await mkActor(T, 'solo@b.test'); await O.createOrganisation(a, 'Solo Co');
    await expect(O.createOrganisation(a, 'Second')).rejects.toMatchObject({ code: 'exists' });
    await expect(O.createOrganisation(await mkActor(T, 'va@b.test', 'vendor_admin'), 'Nope')).rejects.toMatchObject({ code: 'denied' });
    await expect(O.createOrganisation(await mkActor(T, 'blank@b.test'), '  ')).rejects.toMatchObject({ code: 'invalid_name' });
  });
  it('admin plus nine members is the ceiling, counting pending invitations, under concurrent invites', async () => {
    const admin = await mkActor(T, 'cap-admin@b.test'); const { id } = await O.createOrganisation(admin, 'Cap');
    const r = await Promise.allSettled(Array.from({ length: 14 }, (_, i) => O.inviteMember(admin, id, `cap${i}@b.test`)));
    expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(9);
    for (const x of r) if (x.status === 'rejected') expect(x.reason.code).toBe('no_seats');
    expect((await O.listMembers(admin, id)).seats).toEqual({ used: 10, limit: 10 });
  });
  it('invite acceptance needs the matching signed-in customer; no takeover; single use; expiry', async () => {
    const admin = await mkActor(T, 'inv-admin@b.test'); const { id } = await O.createOrganisation(admin, 'Inv');
    const alice = await mkActor(T, 'alice@b.test'); const mallory = await mkActor(T, 'mallory@b.test'); const T2 = await mkTenant('Other'); const foreign = await mkActor(T2, 'alice@other.test');
    await O.inviteMember(admin, id, 'ALICE@b.test'); const tok = await tokenFor('ALICE@b.test');
    await expect(O.acceptInvite(mallory, tok)).rejects.toMatchObject({ code: 'invalid_token' });
    await expect(O.acceptInvite(foreign, tok)).rejects.toMatchObject({ code: 'invalid_token' });
    await O.acceptInvite(alice, tok);
    await expect(O.acceptInvite(alice, tok)).rejects.toMatchObject({ code: 'invalid_token' });
    await O.inviteMember(admin, id, 'bob@b.test'); const bt = await tokenFor('bob@b.test'); await getPool().query("update org_invites set expires_at=now()-interval '1 second'");
    await expect(O.acceptInvite(await mkActor(T, 'bob@b.test'), bt)).rejects.toMatchObject({ code: 'invalid_token' });
  });
  it('only the admin manages members; the admin cannot be removed; transfer swaps atomically', async () => {
    const o = await org('mgmt', 2); const [first, second] = o.members;
    const list = await O.listMembers(o.admin, o.id); const idOf = (e: string) => list.members.find(x => x.email === e)!.id;
    await expect(O.revokeMember(first, o.id, idOf('m1-mgmt@b.test'))).rejects.toMatchObject({ code: 'denied' });
    await expect(O.listMembers(first, o.id)).rejects.toMatchObject({ code: 'denied' });
    await expect(O.revokeMember(o.admin, o.id, idOf('admin-mgmt@b.test'))).rejects.toMatchObject({ code: 'last_admin' });
    await O.transferAdmin(o.admin, o.id, idOf('m0-mgmt@b.test'));
    expect((await O.listMembers(first, o.id)).members.filter(x => x.role === 'admin')).toHaveLength(1); // first is the administrator now
    await expect(O.listMembers(second, o.id)).rejects.toMatchObject({ code: 'denied' });
    await expect(O.listMembers(o.admin, o.id)).rejects.toMatchObject({ code: 'denied' }); // former admin is a member now
    expect((await getPool().query("select count(*)::int n from org_members where org_id=$1 and role='admin' and revoked_at is null", [o.id])).rows[0].n).toBe(1);
  });
  it('other organisations and tenants cannot see or change this one (not-found)', async () => {
    const a = await org('iso-a', 0), b = await org('iso-b', 0);
    await expect(O.listMembers(b.admin, a.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(O.inviteMember(b.admin, a.id, 'x@b.test')).rejects.toMatchObject({ code: 'not_found' });
    await expect(O.usageReport(b.admin, a.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(O.updateProfile(b.admin, a.id, { name: 'Hijack' })).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('private and shared projects; no admin access to private artwork', () => {
  it('admin sees charge metadata but not a member\'s private project, file or output; sharing opens read access to members only', async () => {
    const o = await org('priv', 2); const [m1, m2] = o.members; await fundOrg(o.account, 1_000_000, 'f-priv');
    const { pid, q } = await orgQuote(m1, o.id); const r = await reserveQuote(m1, q.quoteId); await drain();
    const out = (await jobStatus(m1, r.jobId)).outputId!; const src = (await getProject(m1, pid)).source_file_id;
    for (const who of [o.admin, m2]) {
      await expect(getProject(who, pid)).rejects.toMatchObject({ code: 'not_found' });
      await expect(readOutput(who, out)).rejects.toMatchObject({ code: 'not_found' });
      await expect(readOriginal(who, src)).rejects.toMatchObject({ code: 'not_found' });
      await expect(jobStatus(who, r.jobId)).rejects.toMatchObject({ code: 'not_found' });
    }
    const rep = await O.usageReport(o.admin, o.id); expect(rep.rows).toHaveLength(1); expect(rep.rows[0]).toMatchObject({ member: 'm0-priv@b.test', amountPaise: q.customerAmountPaise, status: 'consumed' });
    await expect(O.setVisibility(m2, pid, 'shared')).rejects.toMatchObject({ code: 'not_found' }); // only the owner shares
    await O.setVisibility(m1, pid, 'shared');
    expect((await getProject(m2, pid)).id).toBe(pid); expect((await readOutput(o.admin, out)).buf.length).toBeGreaterThan(0); expect((await readOriginal(m2, src)).length).toBeGreaterThan(0);
    await expect(saveProject(m2, pid, 1, { settings: S })).rejects.toMatchObject({ code: 'not_found' }); // read-only for others
    const outsider = await mkActor(T, 'outsider@b.test'); await expect(getProject(outsider, pid)).rejects.toMatchObject({ code: 'not_found' });
    await expect(readOutput(outsider, out)).rejects.toMatchObject({ code: 'not_found' });
  });
  it('a removed member loses access to organisation projects and files; personal projects are untouched; sharing a personal project is refused', async () => {
    const o = await org('gone', 1); const m = o.members[0];
    const { pid } = await orgQuote(m, o.id); const mine = await createProject(m, 'Personal');
    const list = await O.listMembers(o.admin, o.id); await O.revokeMember(o.admin, o.id, list.members.find(x => x.role === 'member')!.id);
    await expect(getProject(m, pid)).rejects.toMatchObject({ code: 'not_found' });
    await expect(saveProject(m, pid, 1, { settings: S })).rejects.toMatchObject({ code: 'not_found' });
    expect((await getProject(m, mine.id)).id).toBe(mine.id);
    await expect(O.setVisibility(m, mine.id, 'shared')).rejects.toMatchObject({ code: 'not_organisation' });
    await expect(createProject(m, 'Late', o.id)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('shared credit, monthly caps and concurrency', () => {
  it('organisation work draws only on shared credit (not personal credit) plus vendor processing credit', async () => {
    const o = await org('src', 1); const m = o.members[0]; const personal = await fund(T, m.userId, 500_000, 'personal-src'); await fundOrg(o.account, 500_000, 'org-src');
    const { q } = await orgQuote(m, o.id); const r = await reserveQuote(m, q.quoteId); await drain();
    expect((await balance(o.account)).settled).toBe(500_000 - q.customerAmountPaise); expect((await balance(personal)).settled).toBe(500_000);
    expect((await jobStatus(m, r.jobId)).status).toBe('succeeded');
  });
  it('no credit, no work: the organisation balance is the limit even without a member cap', async () => {
    const o = await org('nofund', 1); const { q } = await orgQuote(o.members[0], o.id);
    await expect(reserveQuote(o.members[0], q.quoteId)).rejects.toMatchObject({ code: 'insufficient_organisation_credit' });
  });
  it('20 concurrent reservations by one capped member: exactly as many as the cap allows', async () => {
    const o = await org('cap', 1); const m = o.members[0]; await fundOrg(o.account, 100_000_000, 'cap-fund');
    const p = await createProject(m, 'C', o.id); const f = await saveOriginal(m, await png()); await saveProject(m, p.id, 1, { sourceFileId: f.fileId, settings: S });
    const q0 = await createQuote(m, p.id); const memberId = (await O.listMembers(o.admin, o.id)).members.find(x => x.role === 'member')!.id;
    await O.setMemberLimit(o.admin, o.id, memberId, q0.customerAmountPaise * 3 + 5);
    const quotes = await Promise.all(Array.from({ length: 20 }, () => createQuote(m, p.id)));
    const res = await Promise.allSettled(quotes.map(q => reserveQuote(m, q.quoteId)));
    expect(res.filter(r => r.status === 'fulfilled')).toHaveLength(3);
    for (const r of res) if (r.status === 'rejected') expect(r.reason.code).toBe('member_limit_reached');
    const mem = (await O.listMembers(o.admin, o.id)).members.find(x => x.role === 'member')!; expect(mem.reservedPaise).toBe(q0.customerAmountPaise * 3);
  });
  it('members and the shared balance together: nobody overspends the pool, and each member respects their own cap', async () => {
    const o = await org('pool', 2); const [a, b] = o.members; const ids = (await O.listMembers(o.admin, o.id)).members;
    const mk = async (u: any) => { const p = await createProject(u, 'P', o.id); const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S }); return p.id; };
    const pa = await mk(a), pb = await mk(b); const price = (await createQuote(a, pa)).customerAmountPaise;
    await fundOrg(o.account, price * 5, 'pool-fund'); // pool for exactly 5
    await O.setMemberLimit(o.admin, o.id, ids.find(x => x.email === 'm1-pool@b.test')!.id, price * 2); // b capped at 2, a unlimited
    const qa = await Promise.all(Array.from({ length: 10 }, () => createQuote(a, pa))), qb = await Promise.all(Array.from({ length: 10 }, () => createQuote(b, pb)));
    const res = await Promise.allSettled([...qa.map(q => reserveQuote(a, q.quoteId)), ...qb.map(q => reserveQuote(b, q.quoteId))]);
    const ok = res.filter(r => r.status === 'fulfilled').length; expect(ok).toBe(5);
    const bOk = res.slice(10).filter(r => r.status === 'fulfilled').length; expect(bOk).toBeLessThanOrEqual(2);
    const bal = await balance(o.account); expect(bal.available).toBe(0); expect(bal.held).toBe(price * 5);
  });
  it('releases restore capacity: cancelling a held job frees the member\'s cap and the pool', async () => {
    const o = await org('rel', 1); const m = o.members[0]; await fundOrg(o.account, 100_000_000, 'rel-fund');
    const { pid, q } = await orgQuote(m, o.id); const memberId = (await O.listMembers(o.admin, o.id)).members.find(x => x.role === 'member')!.id;
    await O.setMemberLimit(o.admin, o.id, memberId, q.customerAmountPaise);
    const r = await reserveQuote(m, q.quoteId); const q2 = await createQuote(m, pid);
    await expect(reserveQuote(m, q2.quoteId)).rejects.toMatchObject({ code: 'member_limit_reached' });
    await cancelBeforeDispatch(m, r.jobId);
    expect((await reserveQuote(m, q2.quoteId)).repeated).toBe(false);
  });
  it('lowering a limit below usage blocks new spending but keeps existing work; null removes the ceiling; admin has none', async () => {
    const o = await org('low', 1); const m = o.members[0]; await fundOrg(o.account, 100_000_000, 'low-fund'); const memberId = (await O.listMembers(o.admin, o.id)).members.find(x => x.role === 'member')!.id;
    const { pid, q } = await orgQuote(m, o.id); const r = await reserveQuote(m, q.quoteId); await drain();
    await O.setMemberLimit(o.admin, o.id, memberId, 1);
    expect((await jobStatus(m, r.jobId)).status).toBe('succeeded');
    await expect(reserveQuote(m, (await createQuote(m, pid)).quoteId)).rejects.toMatchObject({ code: 'member_limit_reached' });
    await O.setMemberLimit(o.admin, o.id, memberId, null); expect((await reserveQuote(m, (await createQuote(m, pid)).quoteId)).jobId).toBeTruthy();
    await expect(O.setMemberLimit(o.admin, o.id, memberId, -5)).rejects.toMatchObject({ code: 'invalid_limit' });
    const adminId = (await O.listMembers(o.admin, o.id)).members.find(x => x.role === 'admin')!.id;
    await expect(O.setMemberLimit(o.admin, o.id, adminId, 100)).rejects.toMatchObject({ code: 'invalid_target' });
    await expect(O.setMemberLimit(m, o.id, memberId, 100)).rejects.toMatchObject({ code: 'denied' });
  });
  it('last month\'s spending does not count against this month\'s cap', async () => {
    const o = await org('month', 1); const m = o.members[0]; await fundOrg(o.account, 100_000_000, 'month-fund'); const memberId = (await O.listMembers(o.admin, o.id)).members.find(x => x.role === 'member')!.id;
    const { pid, q } = await orgQuote(m, o.id); await O.setMemberLimit(o.admin, o.id, memberId, q.customerAmountPaise); await reserveQuote(m, q.quoteId);
    await expect(reserveQuote(m, (await createQuote(m, pid)).quoteId)).rejects.toMatchObject({ code: 'member_limit_reached' });
    await getPool().query("update reservations set created_at = created_at - interval '40 days' where org_id=$1", [o.id]);
    expect((await reserveQuote(m, (await createQuote(m, pid)).quoteId)).jobId).toBeTruthy();
  });
  it('a removed member cannot reserve against the organisation', async () => {
    const o = await org('rm', 1); const m = o.members[0]; await fundOrg(o.account, 10_000_000, 'rm-fund'); const { q } = await orgQuote(m, o.id);
    await O.revokeMember(o.admin, o.id, (await O.listMembers(o.admin, o.id)).members.find(x => x.role === 'member')!.id);
    await expect(reserveQuote(m, q.quoteId)).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('usage report and CSV', () => {
  it('filters by member and date; CSV is admin-only, audited, and neutralises formula-leading values', async () => {
    const o = await org('csv', 2); const [a, b] = o.members; await fundOrg(o.account, 100_000_000, 'csv-fund');
    const mk = async (u: any, name: string) => { const p = await createProject(u, name, o.id); const f = await saveOriginal(u, await png()); await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S }); return reserveQuote(u, (await createQuote(u, p.id)).quoteId); };
    await mk(a, '=HYPERLINK("http://evil","x")'); await mk(b, 'Normal, with comma');
    const ids = (await O.listMembers(o.admin, o.id)).members; const aId = ids.find(x => x.email === 'm0-csv@b.test')!.id;
    expect((await O.usageReport(o.admin, o.id)).rows).toHaveLength(2); expect((await O.usageReport(o.admin, o.id, { memberId: aId })).rows).toHaveLength(1);
    expect((await O.usageReport(o.admin, o.id, { from: new Date(Date.now() + 86400000).toISOString() })).rows).toHaveLength(0);
    const csv = await O.usageCsv(o.admin, o.id);
    expect(csv).toContain("\"'=HYPERLINK(\"\"http://evil\"\",\"\"x\"\")\""); expect(csv).toContain('"Normal, with comma"'); expect(csv).not.toMatch(/^=/m);
    await expect(O.usageCsv(a, o.id)).rejects.toMatchObject({ code: 'denied' });
    await expect(O.usageCsv(await mkActor(T, 'csv-out@b.test'), o.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await getPool().query("select count(*)::int n from audit_log where action='org.export'")).rows[0].n).toBe(1);
  });
  it('csvCell protects each dangerous prefix', () => { for (const s of ['=1+1', '+1', '-1', '@cmd', '\tx', '\rx']) expect(csvCell(s).replace(/"/g, '')[0]).toBe("'"); expect(csvCell('safe')).toBe('safe'); });
});
