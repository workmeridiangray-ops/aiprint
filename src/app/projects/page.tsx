'use client';
import { useEffect, useState } from 'react';
type P = { id: string; name: string; updated_at: string };
export default function Projects() {
  const [rows, setRows] = useState<P[] | null>(null); const [err, setErr] = useState('');
  async function load() {
    const r = await fetch('/api/projects');
    if (r.status === 401 || r.status === 403) { location.href = '/login'; return; }
    if (!r.ok) { setErr((await r.json()).message); return; }
    setRows(await r.json());
  }
  useEffect(() => { load(); }, []);
  async function create() {
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Untitled artwork' }) });
    if (r.ok) location.href = `/projects/${(await r.json()).id}`; else setErr((await r.json()).message);
  }
  return <main><h1>Your artwork</h1>
    <button onClick={create}>New artwork</button><p role="alert" className="err">{err}</p>
    {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card">No artwork yet. Create your first project to upload an image.</div> :
      rows.map(p => <div className="card" key={p.id}><a href={`/projects/${p.id}`}>{p.name}</a> <span className="muted">updated {new Date(p.updated_at).toLocaleString()}</span></div>)}
  </main>;
}
