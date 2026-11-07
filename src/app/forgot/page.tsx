'use client';
import { useState } from 'react';
export default function Forgot() {
  const [done, setDone] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    await fetch('/api/auth/reset-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: f.get('email') }) }); setDone(true);
  }
  return <main><div className="card" style={{ maxWidth: 380, margin: '60px auto' }}><h1>Reset password</h1>
    {done ? <p role="status">If an account exists for that email, a reset link has been sent.</p> :
      <form onSubmit={submit}><label htmlFor="email">Email</label><input id="email" name="email" type="email" required /><button>Send reset link</button></form>}</div></main>;
}
