'use client';
import { useState } from 'react';
const j = { 'content-type': 'application/json' };
export default function Login() {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [challenge, setChallenge] = useState<string | null>(null);
  async function land(enrolOnly: boolean) { if (enrolOnly) { location.href = '/account/security'; return; } const staff = await fetch('/api/platform/overview'); location.href = staff.ok ? '/admin' : '/projects'; }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr('');
    const f = new FormData(e.currentTarget);
    const r = await fetch('/api/auth/login', { method: 'POST', headers: j, body: JSON.stringify({ email: f.get('email'), password: f.get('password') }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(b.message ?? 'Sign in failed'); setBusy(false); return; }
    if (b.mfaRequired) { setChallenge(b.challenge); setBusy(false); return; }
    await land(!!b.enrolOnly);
  }
  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr('');
    const r = await fetch('/api/auth/mfa/verify', { method: 'POST', headers: j, body: JSON.stringify({ challenge, code: new FormData(e.currentTarget).get('code') }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(b.message ?? 'Sign in failed'); if (b.error === 'challenge_expired' || b.error === 'too_many_attempts') setChallenge(null); setBusy(false); return; }
    await land(false);
  }
  return <main><div className="card" style={{ maxWidth: 380, margin: '60px auto' }}>
    {challenge === null ? <>
      <h1>Sign in</h1>
      <form onSubmit={submit}>
        <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required />
        <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required />
        <p role="alert" className="err">{err}</p>
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form><p><a href="/forgot">Forgot your password?</a></p></> : <>
      <h1>Enter your code</h1><p className="muted">Open your authenticator app and enter the 6-digit code. Lost your phone? Use one of your recovery codes instead.</p>
      <form onSubmit={verify}>
        <label htmlFor="code">Code</label><input id="code" name="code" autoComplete="one-time-code" inputMode="text" required autoFocus />
        <p role="alert" className="err">{err}</p>
        <button disabled={busy}>{busy ? 'Checking…' : 'Verify'}</button>
      </form></>}
  </div></main>;
}
