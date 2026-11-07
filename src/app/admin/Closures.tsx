'use client';
import { useEffect, useState } from 'react';
const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;
export default function Closures() {
  const [rows, setRows] = useState<any[] | null>(null); const [note, setNote] = useState<Record<string, string>>({}); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  async function load() { const r = await fetch('/api/platform/closures'); if (r.status === 403) { setRows(null); return; } const b = await r.json(); if (r.ok) setRows(b); else setErr(b.message); }
  useEffect(() => { load(); }, []);
  async function complete(id: string) {
    setErr(''); setMsg(''); const r = await fetch(`/api/platform/closures/${id}/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ settlementNote: note[id] ?? '' }) }); const b = await r.json().catch(() => ({}));
    if (!r.ok) setErr(b.message ?? 'Request failed'); else setMsg('Store closed. Its files will be deleted after the purge delay.'); load();
  }
  if (rows === null) return null;
  return <section className="card" id="closures"><h2>Store closures</h2>
    <p className="muted">A store asks to close, customers are told, and it stays open for the notice period so they can download files. Closing is refused while jobs or credit holds are open. Money is not moved by this system: a store with a credit balance needs a written note of how it was settled outside the platform.</p>
    <p role="alert" className="err">{err}</p><p role="status" className="muted">{msg}</p>
    {rows.length === 0 ? <p className="muted">No closures in progress.</p> : rows.map(c => <div className="card" key={c.id} data-status={c.status}>
      <strong>{c.tenantName}</strong> <span className="muted">· {c.status} · asked {new Date(c.requestedAt).toLocaleDateString('en-IN')} · earliest {new Date(c.earliestCloseAt).toLocaleDateString('en-IN')}</span>
      <div>Reason: {c.reason}</div>
      {c.status === 'requested' && c.liabilities && <>
        <div>Open jobs: {c.liabilities.activeJobs} · open credit holds: {c.liabilities.heldReservations} · open tickets: {c.liabilities.openTickets} · investigation holds: {c.liabilities.activeHolds}</div>
        <div>Balances: processing credit {rs(c.liabilities.balancesPaise.vendor_processing_credit)}, customer credit {rs(c.liabilities.balancesPaise.customer_service_credit)}, organisation credit {rs(c.liabilities.balancesPaise.organisation_service_credit)}</div>
        {c.liabilities.blockers.length > 0 && <p className="err">{c.liabilities.blockers.join('; ')}.</p>}
        <label htmlFor={`sn-${c.id}`}>Settlement note {c.liabilities.needsSettlement ? '(required: balances exist)' : '(optional)'}</label>
        <input id={`sn-${c.id}`} maxLength={500} value={note[c.id] ?? ''} onChange={e => setNote({ ...note, [c.id]: e.target.value })} />
        <div className="bar"><button type="button" onClick={() => complete(c.id)}>Close this store</button></div></>}
      {c.status === 'closed' && <div className="muted">Closed {c.closedAt ? new Date(c.closedAt).toLocaleDateString('en-IN') : ''}{c.settlementNote ? ` · settlement: ${c.settlementNote}` : ''} · {c.purgedAt ? `files deleted ${new Date(c.purgedAt).toLocaleDateString('en-IN')}` : `files deleted after ${c.purgeAfter ? new Date(c.purgeAfter).toLocaleDateString('en-IN') : '?'}`}{c.purgeNote ? ` · ${c.purgeNote}` : ''}</div>}
    </div>)}</section>;
}
