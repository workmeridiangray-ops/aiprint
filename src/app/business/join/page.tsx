'use client';
import { useEffect, useState } from 'react';
export default function Join() {
  const [s, setS] = useState('Joining…');
  useEffect(() => { (async () => {
    const token = new URLSearchParams(location.search).get('token') ?? '';
    const r = await fetch('/api/orgs/accept', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
    if (r.status === 401) { location.href = '/login'; return; }
    setS(r.ok ? 'You have joined the organisation.' : (await r.json()).message);
  })(); }, []);
  return <main><div className="card" style={{ maxWidth: 420, margin: '60px auto' }}><h1>Join organisation</h1><p role="status">{s}</p><p className="muted">You must be signed in with the email address that received the invitation.</p><a href="/projects">Go to your projects</a></div></main>;
}
