'use client';
import { useEffect, useRef, useState, use } from 'react';
type S = { widthMm: number; heightMm: number; bleedMm: number; dpi: number; fit: 'fit' | 'fill' };
const DEF: S = { widthMm: 210, heightMm: 297, bleedMm: 3, dpi: 300, fit: 'fill' };
type Save = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict';
const j = { 'content-type': 'application/json' };

export default function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [s, setS] = useState<S>(DEF); const rev = useRef(1); const [sourceId, setSourceId] = useState<string | null>(null);
  const [state, setState] = useState<Save>('saved'); const [msg, setMsg] = useState(''); const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(true); const timer = useRef<any>(null); const dirty = useRef(false);

  useEffect(() => { (async () => {
    const r = await fetch(`/api/projects/${id}`);
    if (r.status === 401) { location.href = '/login'; return; }
    if (!r.ok) { setMsg((await r.json()).message); setLoading(false); return; }
    const p = await r.json(); rev.current = p.revision; setSourceId(p.sourceFileId); if (p.settings?.widthMm) setS({ ...DEF, ...p.settings }); setLoading(false);
  })(); }, [id]);
  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); }; addEventListener('beforeunload', h); return () => removeEventListener('beforeunload', h); }, []);

  async function save(next: S, src: string | null = sourceId) {
    setState('saving'); setMsg('');
    const r = await fetch(`/api/projects/${id}`, { method: 'PATCH', headers: j, body: JSON.stringify({ revision: rev.current, settings: next, sourceFileId: src }) });
    const b = await r.json();
    if (r.ok) { rev.current = b.revision; dirty.current = false; setState('saved'); }
    else if (b.error === 'revision_conflict') { setState('conflict'); setMsg('This project was changed in another window. Reload to see the latest version before editing.'); }
    else { setState('error'); setMsg(b.message ?? 'Could not save'); }
  }
  function change(k: keyof S, v: any) {
    const next = { ...s, [k]: v }; setS(next); dirty.current = true; setState('unsaved'); setQuote(null);
    clearTimeout(timer.current); timer.current = setTimeout(() => save(next), 1200);
  }
  async function upload(f: File) {
    setMsg(''); const fd = new FormData(); fd.append('file', f);
    const r = await fetch('/api/files', { method: 'POST', body: fd }); const b = await r.json();
    if (!r.ok) { setMsg(b.message); return; }
    setSourceId(b.fileId); setMsg(`${b.width}×${b.height}px ${b.format.toUpperCase()}, colour profile: ${b.colourProfile}.`); await save(s, b.fileId);
  }
  async function getQuote() {
    if (state !== 'saved') { setMsg('Wait for the project to finish saving.'); return; }
    const r = await fetch(`/api/projects/${id}/quote`, { method: 'POST' }); const b = await r.json();
    if (r.ok) setQuote(b); else setMsg(b.message);
  }
  async function reserve() {
    const r = await fetch(`/api/quotes/${quote.quoteId}/reserve`, { method: 'POST' }); const b = await r.json();
    if (r.ok) { location.href = `/jobs/${b.jobId}`; } else setMsg(b.message);
  }
  const num = (k: keyof S, label: string, step = 1) => <div><label htmlFor={k}>{label}</label>
    <input id={k} type="number" step={step} value={s[k] as number} onChange={e => change(k, Number(e.target.value))} /></div>;
  if (loading) return <main><p className="muted">Loading…</p></main>;
  return <main><h1>Prepare artwork</h1>
    <p aria-live="polite" role="status">{{ saved: 'All changes saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Save failed', conflict: 'Save blocked: newer version exists' }[state]}</p>
    <p role="alert" className={state === 'saved' ? 'muted' : 'err'}>{msg}</p>
    <div className="card"><label htmlFor="file">Image (JPG or PNG, up to 25 MB / 40 MP)</label>
      <input id="file" type="file" accept="image/jpeg,image/png" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
      <p className="muted">{sourceId ? 'Image attached.' : 'No image yet.'}</p></div>
    <div className="card"><div className="grid">{num('widthMm', 'Width (mm)')}{num('heightMm', 'Height (mm)')}{num('bleedMm', 'Bleed (mm)', 0.5)}{num('dpi', 'Resolution (dpi)', 50)}
      <div><label htmlFor="fit">Placement</label><select id="fit" value={s.fit} onChange={e => change('fit', e.target.value)}><option value="fill">Fill (crop edges)</option><option value="fit">Fit (show all)</option></select></div></div></div>
    <div className="card"><button onClick={getQuote} disabled={!sourceId || state === 'conflict'}>Get price</button>
      {quote && <p>Price ₹{(quote.customerAmountPaise / 100).toFixed(2)}, valid until {new Date(quote.expiresAt).toLocaleTimeString()}. <button onClick={reserve}>Hold funds and queue job</button></p>}</div>
  </main>;
}
