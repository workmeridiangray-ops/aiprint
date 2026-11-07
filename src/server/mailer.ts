import nodemailer from 'nodemailer';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getPool, AppError } from './db';
import type { Actor } from './auth';

export const MAX_ATTEMPTS = 5;
const BACKOFF_MIN = [1, 5, 30, 120];            // minutes before attempts 2..5
const LEASE_MIN = 5;
export type Mail = { to: string; subject: string; text: string; messageId: string };
export type Transport = { send(m: Mail): Promise<void> };

/* ---------- configuration: nothing is "sent" unless a real transport is configured ---------- */
export function emailConfig(): { ok: true; driver: 'smtp' | 'file' } | { ok: false; reason: string } {
  const d = process.env.EMAIL_DRIVER;
  const prod = process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging';
  if (d === 'file') return prod ? { ok: false, reason: 'EMAIL_DRIVER=file is for development only' } : { ok: true, driver: 'file' };
  if (d === 'smtp') {
    const miss = ['SMTP_HOST', 'SMTP_PORT', 'EMAIL_FROM'].filter(k => !process.env[k]);
    return miss.length ? { ok: false, reason: `Missing ${miss.join(', ')}` } : { ok: true, driver: 'smtp' };
  }
  return { ok: false, reason: 'EMAIL_DRIVER is not set (smtp, or file for development)' };
}
export function appUrl() {
  const u = process.env.APP_URL; if (u) return u.replace(/\/$/, '');
  if (process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging') throw new AppError('email_not_configured', 'APP_URL is required to build email links', 503);
  return 'http://localhost:3000';
}
export function makeTransport(): Transport {
  const c = emailConfig(); if (!c.ok) throw new AppError('email_not_configured', c.reason, 503);
  if (c.driver === 'file') return { async send(m) { const dir = path.resolve(process.env.EMAIL_FILE_DIR ?? './.data/mail'); await mkdir(dir, { recursive: true }); await writeFile(path.join(dir, m.messageId.replace(/[^\w.-]/g, '_') + '.eml'), `To: ${m.to}\nSubject: ${m.subject}\nMessage-ID: ${m.messageId}\n\n${m.text}\n`); } };
  const port = Number(process.env.SMTP_PORT);
  const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: process.env.SMTP_REQUIRE_TLS !== 'false' && port !== 465 && process.env.APP_ENV === 'production', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined, connectionTimeout: 15000, socketTimeout: 30000 });
  return { async send(m) { await t.sendMail({ from: process.env.EMAIL_FROM, to: m.to, subject: m.subject, text: m.text, messageId: m.messageId }); } };
}

/* ---------- templates: transactional wording only; no legal or policy text is authored here ---------- */
const ist = (d: unknown) => new Date(String(d)).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
type B = Record<string, any>;
const link = (p: string, token: string) => `${appUrl()}${p}?token=${encodeURIComponent(token)}`;
const tail = '\n\nIf you did not expect this email, you can ignore it.';
export const TEMPLATES: Record<string, (b: B) => { subject: string; text: string }> = {
  verify_email: b => ({ subject: 'Confirm your email address', text: `Confirm your email address to finish setting up your account:\n\n${link('/verify', b.token)}\n\nThis link works once and expires.${tail}` }),
  reset_password: b => ({ subject: 'Reset your password', text: `Use this link to choose a new password:\n\n${link('/reset', b.token)}\n\nThis link works once and expires. Resetting signs you out everywhere.${tail}` }),
  invite: b => ({ subject: 'You have been invited to join a workspace', text: `You have been invited to join a workspace. Accept the invitation and set a password here:\n\n${link('/invite', b.token)}\n\nThis link works once and expires.${tail}` }),
  org_invite: b => ({ subject: 'You have been invited to join an organisation', text: `You have been invited to join an organisation. Sign in with this email address, then open:\n\n${link('/business/join', b.token)}\n\nThis link works once and expires.${tail}` }),
  enquiry_ack: b => ({ subject: `We received your enquiry (${b.reference})`, text: `Thank you for getting in touch. We have received your enquiry. Your reference is ${b.reference}. Please quote it if you contact us again.` }),
  retention_warning: b => ({ subject: 'A finished file will expire soon', text: `One of your finished files expires on ${ist(b.expiresAt)}. After that it can no longer be downloaded. Download it before then from your files page:\n\n${appUrl()}/library` }),
  mfa_disabled: () => ({ subject: 'Two-step sign-in was turned off', text: `Two-step sign-in was turned off on your account and you were signed out everywhere. If this was not you, reset your password now and contact support.` }),
  mfa_reset: () => ({ subject: 'Your two-step sign-in was reset by an administrator', text: `An administrator reset two-step sign-in on your account and signed you out everywhere. Sign in again and set it up again if your role requires it. If you did not ask for this, contact support.` }),
  mfa_recovery_used: () => ({ subject: 'A recovery code was used to sign in', text: `A recovery code was just used to sign in to your account. If this was you, no action is needed; consider making new recovery codes in Account security. If it was not you, reset your password and contact support now.` }),
  ticket_reply: b => ({ subject: `New reply on ${b.reference}`, text: `There is a new reply on your support ticket ${b.reference}. Sign in to read it:\n\n${appUrl()}/support` }),
  ticket_resolved: b => ({ subject: `${b.reference} was marked resolved`, text: `Your support ticket ${b.reference} was marked resolved. Sign in to read the resolution. If it did not fix the problem you can reopen it:\n\n${appUrl()}/support` }),
  account_closed: () => ({ subject: 'Your account was closed', text: `Your account was closed and you were signed out. Your files will be deleted within seven days. Payment and audit records are kept separately from your files. Copies you downloaded earlier cannot be removed remotely.` }),
  subscription_7d: b => ({ subject: 'Your subscription renews in 7 days', text: `Your subscription period ends on ${ist(b.periodEnd)}. Renew before then to keep your store active.` }),
  subscription_1d: b => ({ subject: 'Your subscription ends tomorrow', text: `Your subscription period ends on ${ist(b.periodEnd)}. Renew now to avoid interruption.` }),
  subscription_grace_start: b => ({ subject: 'Your subscription has ended: grace period started', text: `Your subscription period ended on ${ist(b.periodEnd)}. Your store is in a grace period. Renew to keep it active.` }),
  subscription_expired: b => ({ subject: 'Your subscription has expired', text: `Your subscription expired after the grace period that followed ${ist(b.periodEnd)}. Your store is no longer active until it is renewed.` }),
};
export function render(template: string, body: string): { subject: string; text: string } {
  const f = TEMPLATES[template]; if (!f) throw Object.assign(new Error(`unknown email template: ${template}`), { permanent: true });
  let b: B; try { b = JSON.parse(body || '{}'); } catch { throw Object.assign(new Error('unreadable email body'), { permanent: true }); }
  return f(b);
}

/* ---------- delivery ---------- */
const validAddress = (a: string) => /^[^\s@<>,;"\r\n]+@[^\s@<>,;"\r\n]+\.[^\s@<>,;"\r\n]+$/.test(a);
/** At-least-once delivery. Rows are leased (SKIP LOCKED) so two senders never take the same one; a crash after sending but before marking
 *  re-sends once the lease ends, with the same Message-ID so mail systems can de-duplicate. Tokens are scrubbed from the row once it is finished. */
export async function deliverPending(opts: { limit?: number; transport?: Transport; now?: Date } = {}) {
  const out = { sent: 0, retried: 0, failed: 0, blocked: null as string | null };
  let transport = opts.transport;
  if (!transport) { const c = emailConfig(); if (!c.ok) { out.blocked = c.reason; return out; } transport = makeTransport(); }
  const rows = (await getPool().query(
    `update email_outbox set locked_until=now()+interval '${LEASE_MIN} minutes', attempts=attempts+1
     where id in (select id from email_outbox where status='pending' and next_attempt_at<=now() and (locked_until is null or locked_until<now()) order by id limit $1 for update skip locked)
     returning id,to_email,template,body,attempts`, [opts.limit ?? 50])).rows;
  const host = (process.env.EMAIL_FROM ?? 'localhost').split('@').pop()!.replace(/[^\w.-]/g, '');
  for (const r of rows) {
    let permanent = false;
    try {
      if (!validAddress(r.to_email)) throw Object.assign(new Error('invalid recipient address'), { permanent: true });
      const m = render(r.template, r.body);
      await transport.send({ to: r.to_email, subject: m.subject, text: m.text, messageId: `<outbox-${r.id}@${host}>` });
      await getPool().query("update email_outbox set status='sent', sent_at=now(), locked_until=null, last_error=null, body='{}' where id=$1", [r.id]); out.sent++;
    } catch (e: any) {
      permanent = !!e.permanent || (typeof e.responseCode === 'number' && e.responseCode >= 500);
      const msg = String(e?.message ?? e).slice(0, 300);
      if (permanent || r.attempts >= MAX_ATTEMPTS) { await getPool().query("update email_outbox set status='failed', locked_until=null, last_error=$2, body='{}' where id=$1", [r.id, msg]); out.failed++; }
      else { await getPool().query(`update email_outbox set locked_until=null, last_error=$2, next_attempt_at=now()+($3||' minutes')::interval where id=$1`, [r.id, msg, String(BACKOFF_MIN[r.attempts - 1] ?? 120)]); out.retried++; }
    }
  }
  return out;
}

/** Staff view: is mail flowing? Never includes recipients or content. */
export async function emailHealth(actor: Actor) {
  if (!['platform_owner', 'platform_support'].includes(actor.role)) throw new AppError('denied', 'Not permitted', 403);
  const r = (await getPool().query(`select count(*) filter (where status='pending')::int pending, count(*) filter (where status='failed')::int failed,
    coalesce(extract(epoch from now()-min(created_at) filter (where status='pending'))/60,0)::int oldest_minutes from email_outbox`)).rows[0];
  const c = emailConfig();
  return { configured: c.ok, blockedReason: c.ok ? null : c.reason, pending: r.pending as number, failed: r.failed as number, oldestPendingMinutes: r.oldest_minutes as number };
}
