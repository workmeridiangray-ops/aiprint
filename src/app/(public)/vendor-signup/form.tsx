'use client';
import { useState } from 'react';
export default function SignupForm({ planId }: { planId: string }) {
  const [err, setErr] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr(''); const f = new FormData(e.currentTarget);
    const r = await fetch('/api/vendors', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.get('email'), password: f.get('password'), businessName: f.get('business'), slug: f.get('slug'), planId }) });
    if (r.ok) setDone(true); else setErr((await r.json()).message ?? 'Could not register'); setBusy(false);
  }
  if (done) return <div className="card" role="status"><p>Check your email for a link to confirm your address. Your store will open once your subscription payment is confirmed.</p></div>;
  return <form onSubmit={submit} className="card" style={{ maxWidth: 460 }}><p role="alert" className="err">{err}</p>
    <label htmlFor="business">Business name</label><input id="business" name="business" required />
    <label htmlFor="slug">Store web address</label><input id="slug" name="slug" pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" title="3-40 lowercase letters, numbers or hyphens" required /><p className="muted">Letters, numbers and hyphens, for example your-shop</p>
    <label htmlFor="email">Your email</label><input id="email" name="email" type="email" autoComplete="username" required />
    <label htmlFor="password">Password (12 or more characters)</label><input id="password" name="password" type="password" minLength={12} autoComplete="new-password" required />
    <button disabled={busy}>{busy ? 'Registering…' : 'Register'}</button></form>;
}
