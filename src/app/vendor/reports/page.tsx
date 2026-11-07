'use client';
import { useEffect, useState } from 'react';
const KINDS: [string, string][] = [['sales', 'Service sales'], ['receipts', 'Counter receipts'], ['usage', 'Usage'], ['credits', 'Processing credit'], ['staff', 'Staff activity']];
const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;
export default function Reports() {
  const [kind, setKind] = useState('sales'); const [f, setF] = useState({ from: '', to: '', status: '', channel: '' }); const [rep, setRep] = useState<any>(null); const [err, setErr] = useState('');
  const qs = () => new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  async function load() { setErr(''); setRep(null); const r = await fetch(`/api/vendor/reports/${kind}?${qs()}`); if (r.status === 401) { location.href = '/login'; return; } const b = await r.json(); if (r.ok) setRep(b); else setErr(b.message); }
  useEffect(() => { load(); }, [kind]); // eslint-disable-line
  return <main><h1>Reports</h1><p><a href="/vendor">Back to your store</a></p>
    <div className="bar" role="tablist">{KINDS.map(([k, n]) => <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}>{n}</button>)}</div>
    <form onSubmit={e => { e.preventDefault(); load(); }} className="grid">
      <div><label htmlFor="from">From</label><input id="from" type="date" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} /></div>
      <div><label htmlFor="to">To</label><input id="to" type="date" value={f.to} onChange={e => setF({ ...f, to: e.target.value })} /></div>
      {kind === 'sales' && <><div><label htmlFor="st">Status</label><select id="st" value={f.status} onChange={e => setF({ ...f, status: e.target.value })}><option value="">All</option><option>succeeded</option><option>failed</option><option>cancelled</option><option>queued</option><option>running</option></select></div>
        <div><label htmlFor="ch">Channel</label><select id="ch" value={f.channel} onChange={e => setF({ ...f, channel: e.target.value })}><option value="">All</option><option value="online">Online</option><option value="counter">Counter</option></select></div></>}
      <div><button>Show</button> <a href={`/api/vendor/reports/${kind}?format=csv&${qs()}`}>Download CSV</a></div></form>
    <p role="alert" className="err">{err}</p>
    {rep && <><p className="muted">{rep.note}</p>
      <p><strong>Totals:</strong> {Object.entries(rep.totals).map(([k, v]) => `${k.replace(/Paise$/, '')}: ${k.endsWith('Paise') ? rs(Number(v)) : v}`).join(' · ')}</p>
      {rep.truncated && <p className="err">Only the first 5,000 rows are shown. Narrow the dates.</p>}
      <div style={{ overflowX: 'auto' }}><table><thead><tr>{rep.columns.map((c: string) => <th key={c}>{c}</th>)}</tr></thead><tbody>{rep.rows.map((r: any[], i: number) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div>
      {rep.rows.length === 0 && <p className="muted">Nothing matches these filters.</p>}</>}
  </main>;
}
