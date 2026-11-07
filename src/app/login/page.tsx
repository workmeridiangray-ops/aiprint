'use client';
import { useState } from 'react';
export default function Login() {
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr('');
    const f = new FormData(e.currentTarget);
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.get('email'), password: f.get('password') }) });
    if (r.ok) location.href = '/projects'; else { setErr((await r.json()).message ?? 'Sign in failed'); setBusy(false); }
  }
  return <main><div className="card" style={{ maxWidth: 380, margin: '60px auto' }}>
    <h1>Sign in</h1>
    <form onSubmit={submit}>
      <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required />
      <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete="current-password" required />
      <p role="alert" className="err">{err}</p>
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form></div></main>;
}
