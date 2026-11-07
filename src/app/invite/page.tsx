'use client';
import { useState } from 'react';
export default function Invite() {
  const [err, setErr] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); const f = new FormData(e.currentTarget);
    if (f.get('password') !== f.get('again')) { setErr('The two passwords do not match.'); return; }
    setBusy(true);
    const token = new URLSearchParams(location.search).get('token') ?? '';
    const r = await fetch('/api/auth/accept-invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: f.get('password') }) });
    if (r.ok) setDone(true); else setErr((await r.json()).message ?? 'This invitation is no longer valid.'); setBusy(false);
  }
  return <main><div className="card" style={{ maxWidth: 420, margin: '60px auto' }}><h1>Accept invitation</h1>
    {done ? <><p role="status">Your account is ready.</p><a href="/login">Sign in</a></> : <form onSubmit={submit}>
      <label htmlFor="password">Choose a password (at least 12 characters)</label><input id="password" name="password" type="password" minLength={12} autoComplete="new-password" required />
      <label htmlFor="again">Repeat password</label><input id="again" name="again" type="password" minLength={12} autoComplete="new-password" required />
      <p role="alert" className="err">{err}</p><button disabled={busy}>{busy ? 'Saving…' : 'Create my account'}</button></form>}</div></main>;
}
