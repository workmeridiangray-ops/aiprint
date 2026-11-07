'use client';
import { useEffect, useState } from 'react';
export default function Verify() {
  const [s, setS] = useState('Verifying…');
  useEffect(() => { (async () => {
    const token = new URLSearchParams(location.search).get('token') ?? '';
    const r = await fetch('/api/auth/verify-email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    setS(r.ok ? 'Email verified. You can now sign in.' : (await r.json()).message);
  })(); }, []);
  return <main><div className="card" style={{ maxWidth: 380, margin: '60px auto' }}><h1>Verify email</h1><p role="status">{s}</p><a href="/login">Go to sign in</a></div></main>;
}
