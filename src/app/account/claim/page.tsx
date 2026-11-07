'use client';
import { useEffect, useState } from 'react';
type C = { id: string; status: string; receiptNo: string; createdAt: string; reason: string | null };
const label: Record<string, string> = { pending: 'Waiting for the store to check', conflict: 'Waiting: the store is checking more than one request', approved: 'Approved: the files are in your account', rejected: 'Not approved', cancelled: 'Cancelled' };
export default function Claim() {
  const [rows, setRows] = useState<C[] | null>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  async function load() { const r = await fetch('/api/claims?status=all'); if (r.status === 401) { location.href = '/login'; return; } const b = await r.json(); if (r.ok) setRows(b); else setErr(b.message); }
  useEffect(() => { load(); }, []);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setMsg(''); setBusy(true); const f = new FormData(e.currentTarget);
    const r = await fetch('/api/claims', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ receiptNo: f.get('receipt') }) }); const b = await r.json().catch(() => ({}));
    setBusy(false); if (!r.ok) { setErr(b.message ?? 'Request failed'); return; }
    setMsg(b.repeated ? 'You already have a request open for this receipt.' : 'Request sent. The store will check it. Nothing is added to your account until they approve.'); (e.target as HTMLFormElement).reset(); load();
  }
  async function cancel(id: string) { const r = await fetch(`/api/claims/${id}/cancel`, { method: 'POST' }); if (!r.ok) setErr((await r.json()).message); load(); }
  return <main><h1>Claim a walk-in job</h1>
    <p className="muted">If a store made your job for you at the counter, you can ask for those files to be added to your account. You need to be signed in with the same email address the store recorded for you, and the store must approve. A phone number is not enough.</p>
    <p role="alert" className="err">{err}</p><p role="status" className="muted">{msg}</p>
    <form className="card" onSubmit={submit}><label htmlFor="receipt">Receipt number (for example R-123)</label><input id="receipt" name="receipt" required maxLength={30} autoComplete="off" /><button disabled={busy}>Send request</button></form>
    <h2>Your requests</h2>
    {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card">No requests yet.</div> : rows.map(c => <div className="card" key={c.id}><strong>{c.receiptNo}</strong> <span className="muted">· {new Date(c.createdAt).toLocaleDateString()}</span><div data-status={c.status}>{label[c.status] ?? c.status}{c.reason && c.status === 'rejected' ? `: ${c.reason}` : ''}</div>
      {(c.status === 'pending' || c.status === 'conflict') && <button type="button" onClick={() => cancel(c.id)}>Cancel request</button>}{c.status === 'approved' && <p><a href="/library">Open your files</a></p>}</div>)}
    <p><a href="/projects">Back to your artwork</a></p></main>;
}
