'use client';
import { useState, type FormEvent } from 'react';
export const rs = (p: number) => `${p < 0 ? '−' : ''}₹${(Math.abs(p) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const when = (d: string | null | undefined) => d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
export const day = (d: string | null | undefined) => d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '-';
export const words = (s: string) => s.replace(/_/g, ' ');
export async function call(url: string, method = 'GET', body?: unknown) {
  const r = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
  const b = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(b.message ?? 'Request failed'), { code: b.error, status: r.status }); return b;
}
/** Shared message handling: one status line and one alert line that stay on screen until the next action. */
export function useAct(reload: () => Promise<unknown>) {
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>, ok: string) {
    if (busy) return; setBusy(true); setMsg(''); setErr('');
    try { await fn(); setMsg(ok); await reload(); } catch (e: any) { if (e.message !== 'auth') setErr(e.message); } finally { setBusy(false); }
  }
  const form = (fn: (f: FormData) => Promise<unknown>, ok: string, reset = true) => (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); const el = e.currentTarget; const f = new FormData(el); act(async () => { await fn(f); if (reset) el.reset(); }, ok); };
  const Notice = () => <><p role="status" className="ok">{msg}</p><p role="alert" className="err">{err}</p></>;
  return { act, form, busy, Notice, setErr };
}
export const Badge = ({ s }: { s: string }) => <span className={`badge b-${s}`}>{words(s)}</span>;
/** Sensitive actions ask for a current authenticator code when the account has two-step sign-in on; without it the field can stay empty. */
export const CodeField = ({ id }: { id: string }) => <div><label htmlFor={id}>Authenticator code <span className="muted">(if two-step sign-in is on)</span></label><input id={id} name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} style={{ maxWidth: 160 }} /></div>;
