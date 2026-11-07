'use client';
import { useEffect, useState } from 'react';
type Row = { kind: 'online' | 'counter'; id: string; name: string; contact: string | null; since: string; jobs: number; closed: boolean };
export default function Customers() {
  const [rows, setRows] = useState<Row[] | null>(null); const [next, setNext] = useState<string | null>(null); const [q, setQ] = useState(''); const [err, setErr] = useState('');
  async function load(more = false) {
    setErr(''); const p = new URLSearchParams(); if (q) p.set('q', q); if (more && next) p.set('cursor', next);
    const r = await fetch('/api/vendor/customers?' + p); if (r.status === 401) { location.href = '/login'; return; }
    const b = await r.json(); if (!r.ok) { setErr(b.message); return; }
    setRows(more && rows ? [...rows, ...b.rows] : b.rows); setNext(b.nextCursor);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line
  return <main><h1>Customers</h1><p><a href="/vendor">Back to your store</a></p><p role="alert" className="err">{err}</p>
    <form onSubmit={e => { e.preventDefault(); load(); }} className="bar"><label htmlFor="q">Search name, email or contact</label><input id="q" value={q} onChange={e => setQ(e.target.value)} /><button>Search</button></form>
    {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card">No customers found.</div> :
      <table><thead><tr><th>Name</th><th>Type</th><th>Contact</th><th>Since</th><th>Jobs</th></tr></thead><tbody>{rows.map(r => <tr key={r.kind + r.id}><td>{r.name}{r.closed ? ' (account closed)' : ''}</td><td>{r.kind === 'online' ? 'Online account' : 'Counter customer'}</td><td>{r.contact ?? '-'}</td><td>{new Date(r.since).toLocaleDateString()}</td><td>{r.jobs}</td></tr>)}</tbody></table>}
    {next && <button type="button" onClick={() => load(true)}>Show more</button>}
    <p className="muted">Shows only people of your own store. No artwork or balances are shown here.</p></main>;
}
