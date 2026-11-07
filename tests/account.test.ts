import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setupDb, mkTenant, mkActor, fund, closePool } from './helpers';
import { login, resolveActor } from '../src/server/auth';
import { saveOriginal } from '../src/server/files';
import { createProject, saveProject } from '../src/server/projects';
import { createQuote, reserveQuote } from '../src/server/quotes';
import { workOnce, jobStatus, readOutput } from '../src/server/worker';
import { requestExport, downloadExport, requestClosure, confirmClosure, closureStatus, purgeClosedAccounts, runAccountMaintenance } from '../src/server/account';
import { createTicket, addNote } from '../src/server/support';
import { placeHold } from '../src/server/retention';
import { startEnrolment, confirmEnrolment, hotp } from '../src/server/mfa';
import { postEntry, balance } from '../src/server/ledger';
import { register } from '../src/server/identity';
import { createOrganisation } from '../src/server/org';
import { getPool } from '../src/server/db';

const PW = 'correct-horse-battery'; let T: string, P: string; let n = 0;
beforeAll(async () => { await setupDb(); T = await mkTenant('V'); P = await mkTenant('Platform', 'platform'); });
afterAll(closePool);
const S = { widthMm: 50, heightMm: 30, bleedMm: 2, dpi: 300, fit: 'fill' as const };
const png = () => sharp({ create: { width: 400, height: 300, channels: 3, background: '#a62' } }).png().toBuffer();
/** A customer with one finished job. `settle` removes leftover credit with a real ledger entry, as a store settlement would. */
async function withJob(settle: boolean, drain = true) {
  const id = ++n; const u = await mkActor(T, `u${id}@x.test`); const p = await createProject(u, 'Poster ' + id); const f = await saveOriginal(u, await png());
  await saveProject(u, p.id, 1, { sourceFileId: f.fileId, settings: S });
  const acc = await fund(T, u.userId, 100000, 'c' + id); await fund(T, null, 1_000_000, 'v' + id);
  const q = await createQuote(u, p.id); const r = await reserveQuote(u, q.quoteId);
  if (drain) while (await workOnce('w')) { /* drain */ }
  if (settle && drain) { const b = await balance(acc); await postEntry(getPool(), acc, -b.settled, 'test_settlement', 'settle' + id); }
  return { u, id, projectId: p.id, jobId: r.jobId, fileId: f.fileId, outputId: drain ? (await jobStatus(u, r.jobId)).outputId! : null, email: `u${id}@x.test`, acc };
}
const keyOf = async (fileId: string) => (await getPool().query('select storage_key k from stored_files where id=$1', [fileId])).rows[0].k as string;
const onDisk = async (fileId: string) => existsSync(path.join(process.env.STORAGE_LOCAL_DIR!, await keyOf(fileId)));

describe('export', () => {
  it('contains only the requester\'s records and public ticket messages; reused within a day; owner-only download', async () => {
    const a = await withJob(false); const b = await withJob(false);
    const staff = await mkActor(T, `adm${++n}@x.test`, 'vendor_admin'); const t = await createTicket(a.u, { category: 'other', subject: 'My question', body: 'Public words' }); await addNote(staff, t.id, 'INTERNAL SECRET NOTE');
    const e = await requestExport(a.u); const data = await downloadExport(a.u, e.id); const text = JSON.stringify(data);
    expect(data.account.email).toBe(a.email); expect(data.projects).toHaveLength(1); expect(data.files).toHaveLength(1); expect(data.charges).toHaveLength(1);
    expect(text).toContain('Public words'); expect(text).not.toContain('INTERNAL SECRET NOTE'); expect(text).not.toContain(b.email); expect(text).not.toContain(b.projectId);
    expect((await requestExport(a.u))).toMatchObject({ id: e.id, reused: true });
    await expect(downloadExport(b.u, e.id)).rejects.toMatchObject({ code: 'not_found' });
    await expect(requestExport(staff)).rejects.toMatchObject({ code: 'denied' });
  });
  it('expires after seven days and the data is removed', async () => {
    const a = await withJob(false); const e = await requestExport(a.u);
    await getPool().query("update account_requests set expires_at=now()-interval '1 minute' where id=$1", [e.id]);
    await expect(downloadExport(a.u, e.id)).rejects.toMatchObject({ code: 'not_found' });
    expect((await runAccountMaintenance()).exportsExpired).toBeGreaterThanOrEqual(1);
    expect((await getPool().query('select export_data, status from account_requests where id=$1', [e.id])).rows[0]).toEqual({ export_data: null, status: 'expired' });
  });
});

describe('closure is blocked by what is owed', () => {
  it('running job, held funds, leftover credit and organisation admin each block and are listed', async () => {
    const run = await withJob(false, false); const r1 = await requestClosure(run.u, 'leaving');
    expect(r1.status).toBe('blocked'); expect(r1.liabilities.map(l => l.code)).toEqual(expect.arrayContaining(['active_jobs', 'held_funds']));
    while (await workOnce('w')) { /* finish */ }
    const r2 = await requestClosure(run.u, 'leaving'); expect(r2.status).toBe('blocked'); expect(r2.liabilities.map(l => l.code)).toEqual(['credit_balance']); expect(r2.liabilities[0].message).toMatch(/₹/);
    await expect(confirmClosure(run.u, r2.id, PW)).rejects.toMatchObject({ code: 'request_expired' }); // a blocked request cannot be confirmed
    const biz = await withJob(true); const org = await createOrganisation(biz.u, 'Acme'); expect(org).toBeTruthy();
    expect((await requestClosure(biz.u, 'x')).liabilities.map(l => l.code)).toEqual(['org_admin']);
    expect((await closureStatus(biz.u))!.status).toBe('blocked');
  });
  it('store and platform roles cannot use customer closure', async () => {
    const admin = await mkActor(T, `adm${++n}@x.test`, 'vendor_admin'); await expect(requestClosure(admin, 'x')).rejects.toMatchObject({ code: 'denied' });
  });
});

describe('closing an account (WF-22)', () => {
  it('needs the right password, stops access at once, keeps money records, deletes files after the delay, and cannot be reopened by re-registering', async () => {
    const a = await withJob(true); const sess = (await login(a.email, PW)).token!; const led = (await getPool().query('select count(*)::int c from ledger_entries')).rows[0].c;
    const req = await requestClosure(a.u, 'No longer needed'); expect(req.status).toBe('awaiting_confirmation');
    await expect(confirmClosure(a.u, req.id, 'wrong-password-123')).rejects.toMatchObject({ code: 'invalid_credentials' });
    expect((await getPool().query("select status from users where id=$1", [a.u.userId])).rows[0].status).toBe('active');
    const done = await confirmClosure(a.u, req.id, PW); expect(done).toMatchObject({ status: 'closed', purgeInDays: 7 });
    await expect(resolveActor(sess, T)).rejects.toMatchObject({ code: 'session_expired' });
    await expect(login(a.email, PW)).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(readOutput(a.u, a.outputId!)).rejects.toBeDefined();
    expect((await getPool().query('select count(*)::int c from memberships where user_id=$1 and revoked_at is null', [a.u.userId])).rows[0].c).toBe(0);
    expect((await getPool().query("select count(*)::int c from email_outbox where to_email=$1 and template='account_closed'", [a.email])).rows[0].c).toBe(1);
    // money and audit stay
    expect((await getPool().query('select count(*)::int c from ledger_entries')).rows[0].c).toBeGreaterThanOrEqual(led); expect((await getPool().query("select count(*)::int c from reservations r join quotes q on q.id=r.quote_id where q.project_id=$1", [a.projectId])).rows[0].c).toBe(1);
    expect((await getPool().query("select count(*)::int c from audit_log where action='account.closed' and object_id=$1", [a.u.userId])).rows[0].c).toBe(1);
    // files go only after the delay
    expect((await purgeClosedAccounts()).purged).toBe(0); expect(await onDisk(a.fileId)).toBe(true);
    const later = new Date(Date.now() + 8 * 86400000); expect((await purgeClosedAccounts(later)).purged).toBe(1);
    expect(await onDisk(a.fileId)).toBe(false); expect((await purgeClosedAccounts(later)).purged).toBe(0); // rerun is safe
    const row = (await getPool().query("select purged_at, purge_note from account_requests where id=$1", [req.id])).rows[0]; expect(row.purged_at).not.toBeNull(); expect(row.purge_note).toMatch(/payment records/);
    // re-registering the same email does not hand back the old workspace
    await register(a.email, 'another-long-password-1', T); await expect(login(a.email, 'another-long-password-1')).rejects.toBeDefined(); await expect(login(a.email, PW)).rejects.toBeDefined();
    expect((await getPool().query("select status from users where lower(email)=lower($1)", [a.email])).rows).toEqual([{ status: 'disabled' }]);
  });
  it('an investigation hold pauses the file purge', async () => {
    const a = await withJob(true); const staff = await mkActor(P, `own${++n}@x.test`, 'platform_owner');
    const req = await requestClosure(a.u, 'x'); await confirmClosure(a.u, req.id, PW); await placeHold(staff, a.outputId!, 'Open investigation 77');
    const later = new Date(Date.now() + 8 * 86400000); expect(await purgeClosedAccounts(later)).toMatchObject({ purged: 0, held: 1 }); expect(await onDisk(a.fileId)).toBe(true);
    await getPool().query('update retention_holds set released_at=now() where output_id=$1', [a.outputId]); expect((await purgeClosedAccounts(later)).purged).toBe(1); expect(await onDisk(a.fileId)).toBe(false);
  });
  it('a confirmation expires, and repeated wrong passwords lock the account out of confirming', async () => {
    const a = await withJob(true); const req = await requestClosure(a.u, 'x');
    await getPool().query("update account_requests set expires_at=now()-interval '1 minute' where id=$1", [req.id]);
    await expect(confirmClosure(a.u, req.id, PW)).rejects.toMatchObject({ code: 'request_expired' }); expect((await closureStatus(a.u))!.status).toBe('expired');
    const r2 = await requestClosure(a.u, 'x'); for (let i = 0; i < 5; i++) await expect(confirmClosure(a.u, r2.id, 'wrong-password-123')).rejects.toMatchObject({ code: 'invalid_credentials' });
    await expect(confirmClosure(a.u, r2.id, PW)).rejects.toMatchObject({ code: 'too_many_attempts' });
  });
  it('liabilities are re-checked at confirmation: work started after the request blocks it', async () => {
    const a = await withJob(true); const req = await requestClosure(a.u, 'x'); expect(req.status).toBe('awaiting_confirmation');
    await fund(T, a.u.userId, 50000, 'late' + a.id); const done = await confirmClosure(a.u, req.id, PW);
    expect(done.status).toBe('blocked'); expect((await getPool().query('select status from users where id=$1', [a.u.userId])).rows[0].status).toBe('active');
  });
  it('with two-step sign-in on, closing also needs a current code', async () => {
    const a = await withJob(true); const s = await startEnrolment(a.u);
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const out: number[] = []; for (const ch of s.secret) { v = (v << 5) | A.indexOf(ch); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } }
    const key = Buffer.from(out); const step = Math.floor(Date.now() / 30000); await confirmEnrolment(a.u, hotp(key, step));
    const req = await requestClosure(a.u, 'x'); await expect(confirmClosure(a.u, req.id, PW)).rejects.toMatchObject({ code: 'invalid_code' });
    await expect(confirmClosure(a.u, req.id, PW, hotp(key, step + 1))).resolves.toMatchObject({ status: 'closed' });
  });
});
