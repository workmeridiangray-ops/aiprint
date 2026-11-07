'use client';
import { useState } from 'react';
export default function RegisterForm({ storeSlug }: { storeSlug: string }) {
  const [err, setErr] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr(''); const f = new FormData(e.currentTarget);
    const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.get('email'), password: f.get('password'), storeSlug }) });
    if (r.ok) setDone(true); else setErr((await r.json()).message ?? 'Could not register'); setBusy(false);
  }
  if (done) return <div className="card" role="status"><p>Check your email for a link to confirm your address. You can sign in once it is confirmed.</p></div>;
  return <form onSubmit={submit} className="card" style={{ maxWidth: 420 }}><p role="alert" className="err">{err}</p>
    <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="username" required />
    <label htmlFor="password">Password (12 or more characters)</label><input id="password" name="password" type="password" minLength={12} autoComplete="new-password" required />
    <button disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button></form>;
}
