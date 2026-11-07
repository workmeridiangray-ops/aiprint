'use client';
import { useEffect, useState } from 'react';
type Row = { kind: 'online' | 'counter'; id: string; name: string; contact: string | null; since: string; jobs: number; closed: boolean };
export default function Customers() {
  const [rows, setRows] = useState<Row[] | null>(null); const [next, setNext] = useState<string | null>(null); const [q, setQ] = useState(''); const [err, setErr] = useState(''); const [admin, setAdmin] = useState(false); const [edit, setEdit] = useState<string | null>(null); const [msg, setMsg] = useState('');
  async function load(more = false) {
    setErr(''); const p = new URLSearchParams(); if (q) p.set('q', q); if (more && next) p.set('cursor', next);
    const r = await fetch('/api/vendor/customers?' + p); if (r.status === 401) { location.href = '/login'; return; }
    const b = await r.json(); if (!r.ok) { setErr(b.message); return; }
    setRows(more && rows ? [...rows, ...b.rows] : b.rows); setNext(b.nextCursor); setAdmin(!!b.isAdmin);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line
  async function correct(e: React.FormEvent<HTMLFormElement>, id: string) {
    e.preventDefault(); setErr(''); setMsg(''); const f = new FormData(e.currentTarget);
    const r = await fetch(`/api/counter/customers/${id}/contact`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contact: f.get('contact'), reason: f.get('reason') }) }); const b = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(b.message ?? 'Request failed'); return; } setEdit(null); setMsg('Contact corrected. The old value is kept in the record history.'); load();
  }
  return <main><h1>Customers</h1><p><a href="/vendor">Back to your store</a></p><p role="alert" className="err">{err}</p><p role="status" className="muted">{msg}</p>
    <form onSubmit={e => { e.preventDefault(); load(); }} className="bar"><label htmlFor="q">Search name, email or contact</label><input id="q" value={q} onChange={e => setQ(e.target.value)} /><button>Search</button></form>
    {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card">No customers found.</div> :
      <table><thead><tr><th>Name</th><th>Type</th><th>Contact</th><th>Since</th><th>Jobs</th>{admin && <th>Walk-in record</th>}</tr></thead><tbody>{rows.map(r => <tr key={r.kind + r.id}><td>{r.name}{r.closed ? ' (account closed)' : ''}</td><td>{r.kind === 'online' ? 'Online account' : 'Counter customer'}</td><td>{r.contact ?? '-'}</td><td>{new Date(r.since).toLocaleDateString()}</td><td>{r.jobs}</td>{admin && <td>{r.kind === 'counter' ? (edit === r.id ? <form onSubmit={e => correct(e, r.id)}><label htmlFor={`c-${r.id}`}>New contact (email)</label><input id={`c-${r.id}`} name="contact" required maxLength={120} /><label htmlFor={`w-${r.id}`}>Reason</label><input id={`w-${r.id}`} name="reason" required minLength={5} maxLength={300} /><button>Save</button> <button type="button" onClick={() => setEdit(null)}>Cancel</button></form> : <button type="button" onClick={() => setEdit(r.id)}>Correct contact</button>) : ''}</td>}</tr>)}</tbody></table>}
    {next && <button type="button" onClick={() => load(true)}>Show more</button>}
    <p className="muted">Shows only people of your own store. No artwork or balances are shown here.</p></main>;
}
