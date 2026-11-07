'use client';
import { useState } from 'react';
export default function Reset() {
  const [err, setErr] = useState(''); const [ok, setOk] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    const token = new URLSearchParams(location.search).get('token') ?? '';
    const r = await fetch('/api/auth/reset-confirm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, password: f.get('password') }) });
    if (r.ok) setOk(true); else setErr((await r.json()).message);
  }
  return <main><div className="card" style={{ maxWidth: 380, margin: '60px auto' }}><h1>Choose a new password</h1>
    {ok ? <p role="status">Password changed. <a href="/login">Sign in</a></p> :
      <form onSubmit={submit}><label htmlFor="password">New password (12+ characters)</label><input id="password" name="password" type="password" minLength={12} autoComplete="new-password" required />
        <p role="alert" className="err">{err}</p><button>Change password</button></form>}</div></main>;
}
