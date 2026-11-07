'use client';
import { useEffect, useState } from 'react';
type L = { id: string; projectName: string; format: string; widthPx: number; heightPx: number; createdAt: string; expiresAt: string; state: 'available' | 'expiring' | 'expired' | 'removed'; daysLeft: number | null; mine: boolean };
type T = { personalCredit: { settled: number; held: number; available: number }; rows: { date: string; project: string; amountPaise: number; status: string; paidFrom: string }[] };
const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;
export default function Library() {
  const [rows, setRows] = useState<L[] | null>(null); const [tx, setTx] = useState<T | null>(null); const [err, setErr] = useState(''); const [confirm, setConfirm] = useState<string | null>(null);
  async function load() {
    const r = await fetch('/api/library');
    if (r.status === 401 || r.status === 403) { location.href = '/login'; return; }
    if (!r.ok) { setErr((await r.json()).message); return; }
    setRows(await r.json()); const t = await fetch('/api/transactions'); if (t.ok) setTx(await t.json());
  }
  useEffect(() => { load(); }, []);
  async function remove(id: string) { const r = await fetch(`/api/library/${id}`, { method: 'DELETE' }); setConfirm(null); if (!r.ok) setErr((await r.json()).message); else load(); }
  const note = (o: L) => o.state === 'available' ? `Available for ${o.daysLeft} more days` : o.state === 'expiring' ? `Expires in ${o.daysLeft} day${o.daysLeft === 1 ? '' : 's'}. Download it now to keep a copy.` : o.state === 'expired' ? 'Expired: the file is past its 90-day retention period and is no longer available.' : 'Removed.';
  return <main><h1>Your files</h1><p className="muted">Finished files are kept for 90 days, and you can re-download them free during that time.</p><p role="alert" className="err">{err}</p>
    {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card">No finished files yet. Files appear here once a job completes.</div> :
      rows.map(o => <div className="card" key={o.id}>
        <strong>{o.projectName}</strong> <span className="muted">{o.format.toUpperCase()} · {o.widthPx}×{o.heightPx}px · made {new Date(o.createdAt).toLocaleDateString()}{o.mine ? '' : ' · shared with you'}</span>
        <div className={o.state === 'expiring' ? 'err' : 'muted'} data-state={o.state}>{note(o)}</div>
        <div className="bar">{(o.state === 'available' || o.state === 'expiring') && <a href={`/api/outputs/${o.id}/download`}>Download</a>}
          {o.mine && (o.state === 'available' || o.state === 'expiring' || o.state === 'expired') && (confirm === o.id
            ? <><span>Delete this file? It cannot be recovered. Your payment record stays.</span><button onClick={() => remove(o.id)}>Yes, delete</button><button onClick={() => setConfirm(null)}>Keep</button></>
            : <button onClick={() => setConfirm(o.id)}>Delete file</button>)}</div></div>)}
    <h2>Credit and charges</h2>
    {tx && <><p>Your credit: <strong>{rs(tx.personalCredit.available)}</strong> available <span className="muted">({rs(tx.personalCredit.held)} held for running jobs)</span></p>
      {tx.rows.length === 0 ? <div className="card">No charges yet.</div> : <table><thead><tr><th>Date</th><th>Project</th><th>Amount</th><th>Status</th><th>Paid from</th></tr></thead><tbody>
        {tx.rows.map((x, i) => <tr key={i}><td>{new Date(x.date).toLocaleDateString()}</td><td>{x.project}</td><td>{rs(x.amountPaise)}</td><td>{x.status}</td><td>{x.paidFrom}</td></tr>)}</tbody></table>}</>}
    <p><a href="/projects">Back to your artwork</a></p></main>;
}
