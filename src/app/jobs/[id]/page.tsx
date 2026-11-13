'use client';
import { useEffect, useState, use } from 'react';
const LABEL: Record<string, string> = { queued: 'Waiting to start', running: 'Preparing your file', succeeded: 'Ready', failed: 'Could not be prepared', cancelled: 'Cancelled', cancellation_requested: 'Cancelling…', needs_review: 'Being reviewed by support' };
export default function Job({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const [s, setS] = useState<any>(null); const [err, setErr] = useState(''); const [sent, setSent] = useState('');
  useEffect(() => {
    let alive = true; let t: any;
    const tick = async () => {
      const r = await fetch(`/api/jobs/${id}`);
      if (r.status === 401) { location.href = '/login'; return; }
      const b = await r.json(); if (!alive) return;
      if (!r.ok) { setErr(b.message); return; } setS(b); setErr('');
      if (['queued', 'running', 'cancellation_requested'].includes(b.status)) t = setTimeout(tick, 2000);
    };
    tick().catch(() => setErr('Connection problem. Retrying…')); return () => { alive = false; clearTimeout(t); };
  }, [id]);
  return <main><h1>Your file</h1><p role="alert" className="err">{err}</p>
    {!s ? <p className="muted">Loading…</p> : <div className="card" aria-live="polite"><p><strong>{LABEL[s.status] ?? s.status}</strong></p>
      {s.message && <p>{s.message}</p>}
      {s.outputId && <p><img src={`/api/outputs/${s.outputId}/preview`} alt="Watermarked preview of your finished file" style={{ maxWidth: '100%', width: 420, height: 'auto', border: '1px solid var(--line, #ccc)' }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} /><br /><span className="muted">Preview only (watermarked, reduced size). Your download is the clean file.</span></p>}
      {s.outputId && <button type="button" onClick={async () => { const r = await fetch(`/api/outputs/${s.outputId}/link`, { method: 'POST' }); const b = await r.json(); if (r.ok) location.href = b.url; else setErr(b.message); }}>Download</button>}</div>}
    {s?.status === 'succeeded' && <details className="card"><summary>Problem with this file? Ask for a refund</summary>
      <form onSubmit={async e => { e.preventDefault(); setErr(''); setSent(''); const f = new FormData(e.currentTarget); const r = await fetch('/api/refunds', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'job_charge', jobId: id, amountPaise: Math.round(Number(f.get('amount')) * 100), reason: f.get('reason'), method: f.get('method') }) }); const b = await r.json().catch(() => ({})); if (r.ok) setSent(`Request ${b.reference} sent. The store decides; you will be emailed when it is approved and again when it has been returned.`); else setErr(b.message ?? 'Could not send the request'); }}>
        <label htmlFor="ra">Amount to refund (₹)</label><input id="ra" name="amount" type="number" min="0.01" step="0.01" required />
        <label htmlFor="rm">How should it come back?</label><select id="rm" name="method"><option value="credit">As credit in my account (fastest)</option><option value="provider">To the bank or card I paid with</option></select>
        <label htmlFor="rr">What went wrong</label><textarea id="rr" name="reason" minLength={10} maxLength={2000} required rows={3} />
        <p className="muted">A full refund ends further downloads of this file. If the file can simply be fixed, <a href="/support">ask for help instead</a>.</p><button>Send refund request</button></form>
      <p role="status" className="ok">{sent}</p></details>}
    <p><a href="/projects">Back to your artwork</a> · <a href="/credits">Credit and payments</a></p></main>;
}
