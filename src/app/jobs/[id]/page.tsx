'use client';
import { useEffect, useState, use } from 'react';
const LABEL: Record<string, string> = { queued: 'Waiting to start', running: 'Preparing your file', succeeded: 'Ready', failed: 'Could not be prepared', cancelled: 'Cancelled', cancellation_requested: 'Cancelling…', needs_review: 'Being reviewed by support' };
export default function Job({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const [s, setS] = useState<any>(null); const [err, setErr] = useState('');
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
    <p><a href="/projects">Back to your artwork</a></p></main>;
}
