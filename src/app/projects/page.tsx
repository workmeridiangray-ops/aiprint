'use client';
import { useEffect, useState } from 'react';
type P = { id: string; name: string; updated_at: string; org_id: string | null; org_name: string | null; visibility: string; mine: boolean };
export default function Projects() {
  const [rows, setRows] = useState<P[] | null>(null); const [orgs, setOrgs] = useState<{ id: string; name: string }[]>([]); const [err, setErr] = useState('');
  async function load() {
    const r = await fetch('/api/projects');
    if (r.status === 401 || r.status === 403) { location.href = '/login'; return; }
    if (!r.ok) { setErr((await r.json()).message); return; }
    setRows(await r.json());
    const o = await fetch('/api/orgs'); if (o.ok) setOrgs(await o.json());
  }
  useEffect(() => { load(); }, []);
  async function create(orgId?: string) {
    const r = await fetch('/api/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Untitled artwork', orgId }) });
    if (r.ok) location.href = `/projects/${(await r.json()).id}`; else setErr((await r.json()).message);
  }
  return <main><h1>Your artwork</h1>
    <div className="bar"><button onClick={() => create()}>New artwork</button>{orgs.map(o => <button key={o.id} onClick={() => create(o.id)}>New artwork in {o.name}</button>)}<a href="/library">Your files</a><a href="/credits">Credit and payments</a><a href="/support">Help</a><a href="/account/security">Security</a><a href="/account/data">My data</a><a href="/account/claim">Claim a walk-in job</a><a href="/business">{orgs.length ? 'Organisation' : 'Set up an organisation'}</a></div><p role="alert" className="err">{err}</p>
    {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card">No artwork yet. Create your first project to upload an image.</div> :
      rows.map(p => <div className="card" key={p.id}><a href={`/projects/${p.id}`}>{p.name}</a> <span className="muted">{p.org_name ? `${p.org_name}${p.mine ? (p.visibility === 'shared' ? ', shared' : ', private') : ', shared with you'} · ` : ''}updated {new Date(p.updated_at).toLocaleString()}</span></div>)}
  </main>;
}
