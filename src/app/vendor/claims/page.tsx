'use client';
import { useEffect, useState } from 'react';
type R = { id: string; status: string; receiptNo: string; createdAt: string; requesterEmail: string; counterCustomerId: string; customerName: string; recordedContact: string | null; contactMatches: boolean; projects: number; jobs: number; reason: string | null };
export default function Claims() {
  const [rows, setRows] = useState<R[] | null>(null); const [all, setAll] = useState(false); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [why, setWhy] = useState<Record<string, string>>({});
  async function load() { setErr(''); const r = await fetch('/api/claims?status=' + (all ? 'all' : 'open')); if (r.status === 401) { location.href = '/login'; return; } const b = await r.json(); if (r.ok) setRows(b); else setErr(b.message); }
  useEffect(() => { load(); }, [all]); // eslint-disable-line
  async function decide(id: string, decision: 'approve' | 'reject') {
    setErr(''); setMsg(''); const r = await fetch(`/api/claims/${id}/decision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision, reason: why[id] ?? '' }) }); const b = await r.json().catch(() => ({}));
    if (!r.ok) setErr(b.message ?? 'Request failed'); else setMsg(decision === 'approve' ? 'Approved. The customer now owns those files.' : 'Rejected. The customer was told.'); load();
  }
  return <main><h1>Walk-in claims</h1><p><a href="/vendor">Back to your store</a></p>
    <p className="muted">A customer who was served at your counter can ask for those files to be added to their online account. Check the receipt and the person, then approve or reject. Their payment records are not changed. A claim is only possible when your record holds the customer’s email address; to add one, use Correct contact on the Customers page.</p>
    <p role="alert" className="err">{err}</p><p role="status" className="muted">{msg}</p>
    <label className="check"><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> Show decided claims too</label>
    {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card">No claims waiting.</div> : rows.map(c => <div className="card" key={c.id} data-status={c.status}>
      <strong>{c.customerName}</strong> <span className="muted">· receipt {c.receiptNo} · {c.jobs} job{c.jobs === 1 ? '' : 's'}, {c.projects} project{c.projects === 1 ? '' : 's'} · asked {new Date(c.createdAt).toLocaleDateString()}</span>
      <div>Requested by <strong>{c.requesterEmail}</strong> (verified email). Contact on your record: <strong>{c.recordedContact ?? 'none'}</strong>. {c.contactMatches ? 'They match.' : <span className="err">They do not match now, so this cannot be approved.</span>}</div>
      {c.status === 'conflict' && <p role="alert" className="err">More than one person has claimed this record. Approve only the right person, and write why.</p>}
      {(c.status === 'pending' || c.status === 'conflict') ? <><label htmlFor={`why-${c.id}`}>Reason {c.status === 'conflict' ? '(required to approve; required to reject)' : '(required to reject; optional to approve)'}</label>
        <input id={`why-${c.id}`} value={why[c.id] ?? ''} maxLength={300} onChange={e => setWhy({ ...why, [c.id]: e.target.value })} />
        <div className="bar"><button type="button" disabled={!c.contactMatches} onClick={() => decide(c.id, 'approve')}>Approve and give them the files</button><button type="button" onClick={() => decide(c.id, 'reject')}>Reject</button></div></>
        : <div className="muted">{c.status}{c.reason ? `: ${c.reason}` : ''}</div>}</div>)}
  </main>;
}
