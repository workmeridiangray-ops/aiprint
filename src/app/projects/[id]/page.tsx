'use client';
import { useEffect, useRef, useState, use, useCallback } from 'react';
import { placement, dpiLevel, LOW_DPI_WARN } from '@/lib/geometry';

type S = { widthMm: number; heightMm: number; bleedMm: number; dpi: number; fit: 'fit' | 'fill'; format: 'png' | 'jpg' | 'tiff' | 'pdf'; colour: 'rgb' | 'cmyk'; enhance: 'off' | '2x' | '4x'; offsetXMm: number; offsetYMm: number; rotationDeg: number; scale: number };
const DEF: S = { widthMm: 210, heightMm: 297, bleedMm: 3, dpi: 300, fit: 'fill', format: 'png', colour: 'rgb', enhance: 'off', offsetXMm: 0, offsetYMm: 0, rotationDeg: 0, scale: 1 };
const PRESETS: Record<string, [number, number]> = { 'A4 (210 × 297)': [210, 297], 'A5 (148 × 210)': [148, 210], 'A6 (105 × 148)': [105, 148], 'Business card (90 × 55)': [90, 55], 'Poster A3 (297 × 420)': [297, 420] };
const SAFE_MM = 3;
type Save = 'saved' | 'saving' | 'unsaved' | 'error' | 'conflict' | 'offline';
const j = { 'content-type': 'application/json' };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export default function Editor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [s, setS] = useState<S>(DEF); const sRef = useRef(s); sRef.current = s;
  const editStart = useRef<S | null>(null); const past = useRef<S[]>([]); const future = useRef<S[]>([]); const [, bump] = useState(0);
  const rev = useRef(1); const [sourceId, setSourceId] = useState<string | null>(null);
  const [state, setState] = useState<Save>('saved'); const [msg, setMsgRaw] = useState(''); const [bad, setBad] = useState(false); const setMsg = (m: string, isErr = false) => { setMsgRaw(m); setBad(isErr && !!m); }; const [quote, setQuote] = useState<any>(null);
  const [loading, setLoading] = useState(true); const timer = useRef<any>(null); const dirty = useRef(false);
  const [meta, setMeta] = useState<{ orgId: string | null; visibility: string; mine: boolean }>({ orgId: null, visibility: 'private', mine: true }); const [zoom, setZoom] = useState(1); const [imgInfo, setImgInfo] = useState<{ w: number; h: number; profile?: string } | null>(null);
  const hit = useRef<{ cx: number; cy: number; hx: number; hy: number; pxPerMm: number } | null>(null); const drag = useRef<null | { kind: 'move' | 'scale'; x: number; y: number; start: S; d0: number }>(null);
  const img = useRef<HTMLImageElement | null>(null); const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => { (async () => {
    const r = await fetch(`/api/projects/${id}`);
    if (r.status === 401) { location.href = '/login'; return; }
    if (!r.ok) { setMsg((await r.json()).message, true); setLoading(false); return; }
    const p = await r.json(); rev.current = p.revision; setSourceId(p.sourceFileId); setMeta({ orgId: p.orgId, visibility: p.visibility, mine: p.mine }); if (p.settings?.widthMm) setS({ ...DEF, ...p.settings }); setLoading(false);
  })().catch(() => { setMsg('Could not load. Check your connection and reload.', true); setLoading(false); }); }, [id]);

  useEffect(() => { if (!sourceId) { img.current = null; setImgInfo(null); return; }
    const im = new Image(); im.onload = () => { img.current = im; setImgInfo({ w: im.naturalWidth, h: im.naturalHeight }); draw(); };
    im.onerror = () => setMsg('The image could not be loaded for preview.', true); im.src = `/api/files/${sourceId}`; }, [sourceId]); // eslint-disable-line

  useEffect(() => { const h = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); }; addEventListener('beforeunload', h); return () => removeEventListener('beforeunload', h); }, []);
  useEffect(() => { const on = () => dirty.current && scheduleSave(sRef.current, 0); const off = () => setState(st => (st === 'saved' ? st : 'offline')); addEventListener('online', on); addEventListener('offline', off); return () => { removeEventListener('online', on); removeEventListener('offline', off); }; }); // eslint-disable-line

  function pt(e: React.PointerEvent) { const c = canvas.current!; const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height), ratio: c.width / r.width }; }
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!meta.mine || !hit.current) return; const p = pt(e); const h = hit.current;
    const onHandle = Math.abs(p.x - h.hx) <= 14 && Math.abs(p.y - h.hy) <= 14;
    drag.current = { kind: onHandle ? 'scale' : 'move', x: p.x, y: p.y, start: sRef.current, d0: Math.hypot(h.hx - h.cx, h.hy - h.cy) };
    e.currentTarget.setPointerCapture(e.pointerId); e.currentTarget.focus({ preventScroll: true });
  }
  function moveP(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = pt(e); const h = hit.current; const d = drag.current;
    if (!d || !h) { e.currentTarget.style.cursor = h && Math.abs(p.x - h.hx) <= 14 && Math.abs(p.y - h.hy) <= 14 ? 'nwse-resize' : 'grab'; return; }
    if (d.kind === 'move') {
      const next = { ...d.start, offsetXMm: +(d.start.offsetXMm + (p.x - d.x) / h.pxPerMm).toFixed(2), offsetYMm: +(d.start.offsetYMm + (p.y - d.y) / h.pxPerMm).toFixed(2) };
      setS(next); dirty.current = true; setState('unsaved'); setQuote(null);
    } else if (d.d0 > 0) {
      const dist = Math.hypot(p.x - h.cx, p.y - h.cy);
      const next = { ...d.start, scale: +clamp(d.start.scale * (dist / d.d0), 0.05, 20).toFixed(3) };
      setS(next); dirty.current = true; setState('unsaved'); setQuote(null);
    }
  }
  function up() {
    const d = drag.current; drag.current = null; if (!d) return;
    if (JSON.stringify(d.start) === JSON.stringify(sRef.current)) return;
    past.current.push(d.start); if (past.current.length > 100) past.current.shift(); future.current = []; scheduleSave(sRef.current); bump(x => x + 1);
  }
  const geo = imgInfo ? placement(imgInfo.w, imgInfo.h, s) : null;
  const enhF = s.enhance === '4x' ? 4 : s.enhance === '2x' ? 2 : 1;
  const eff = geo ? geo.effectiveDpi * enhF : null; // enhancement gives the export more real pixels per mm
  const [enhPrev, setEnhPrev] = useState<{ before: string; after: string; factor: number } | null>(null); const [enhBusy, setEnhBusy] = useState(false);
  async function previewEnhance() {
    if (s.enhance === 'off') return; setEnhBusy(true); setEnhPrev(null);
    try { const r = await fetch(`/api/projects/${id}/enhance-preview`, { method: 'POST', headers: j, body: JSON.stringify({ enhance: s.enhance }) }); const b = await r.json(); if (!r.ok) setMsg(b.message, true); else setEnhPrev(b); }
    catch { setMsg('Could not make the preview. Check your connection.', true); } finally { setEnhBusy(false); }
  }

  const draw = useCallback(() => {
    const c = canvas.current; const im = img.current; if (!c) return;
    const cur = sRef.current; const outW = Math.round((cur.widthMm + 2 * cur.bleedMm) / 25.4 * cur.dpi), outH = Math.round((cur.heightMm + 2 * cur.bleedMm) / 25.4 * cur.dpi);
    const maxW = Math.min(720, (c.parentElement?.clientWidth ?? 720)) * zoom; const k = maxW / outW;
    c.width = Math.round(outW * k); c.height = Math.round(outH * k);
    const ctx = c.getContext('2d')!; const mm = (outW / (cur.widthMm + 2 * cur.bleedMm)) * k; // canvas px per mm
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    const b = cur.bleedMm * mm, tw = cur.widthMm * mm, th = cur.heightMm * mm;
    if (im) {
      const g = placement(im.naturalWidth, im.naturalHeight, cur); const pk = k; // geometry is in output px
      ctx.save(); ctx.beginPath(); ctx.rect(b, b, tw, th); ctx.clip();
      ctx.translate(b + (g.left + g.nw / 2) * pk, b + (g.top + g.nh / 2) * pk); ctx.rotate((cur.rotationDeg * Math.PI) / 180);
      ctx.drawImage(im, (-im.naturalWidth * g.total * pk) / 2, (-im.naturalHeight * g.total * pk) / 2, im.naturalWidth * g.total * pk, im.naturalHeight * g.total * pk); ctx.restore();
      const a = (cur.rotationDeg * Math.PI) / 180, hw = (im.naturalWidth * g.total * pk) / 2, hh = (im.naturalHeight * g.total * pk) / 2;
      const cx = b + (g.left + g.nw / 2) * pk, cy = b + (g.top + g.nh / 2) * pk;
      const hx = clamp(cx + hw * Math.cos(a) - hh * Math.sin(a), 10, c.width - 10), hy = clamp(cy + hw * Math.sin(a) + hh * Math.cos(a), 10, c.height - 10); // kept on the canvas so it can always be grabbed
      hit.current = { cx, cy, hx, hy, pxPerMm: mm };
      ctx.fillStyle = '#0f5f63'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.rect(hx - 7, hy - 7, 14, 14); ctx.fill(); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(15,95,99,.12)'; ctx.fillRect(0, 0, c.width, b); ctx.fillRect(0, c.height - b, c.width, b); ctx.fillRect(0, b, b, th); ctx.fillRect(c.width - b, b, b, th); // bleed area (filled by edge mirroring on export)
    ctx.lineWidth = 1; ctx.strokeStyle = '#c0392b'; ctx.strokeRect(b + .5, b + .5, tw, th); // trim
    ctx.setLineDash([5, 4]); ctx.strokeStyle = '#1f7a3a'; ctx.strokeRect(b + SAFE_MM * mm, b + SAFE_MM * mm, tw - 2 * SAFE_MM * mm, th - 2 * SAFE_MM * mm); ctx.setLineDash([]); // safe
  }, [zoom]);
  useEffect(() => { draw(); }, [draw, s, imgInfo, loading]);

  async function save(next: S, src: string | null = sourceId) {
    setState('saving'); setMsg('');
    try {
      const r = await fetch(`/api/projects/${id}`, { method: 'PATCH', headers: j, body: JSON.stringify({ revision: rev.current, settings: next, sourceFileId: src }) });
      const b = await r.json();
      if (r.ok) { rev.current = b.revision; dirty.current = JSON.stringify(sRef.current) !== JSON.stringify(next); setState(dirty.current ? 'unsaved' : 'saved'); }
      else if (r.status === 401) { setState('error'); setMsg('Your session has expired. Sign in again; your last saved version is kept.'); }
      else if (b.error === 'revision_conflict') { setState('conflict'); setMsg('This project was changed in another window. Reload to see the latest version before editing.'); }
      else { setState('error'); setMsg(b.message ?? 'Could not save'); }
    } catch { setState('offline'); setMsg('You are offline. Changes are not saved yet; they will be retried when you reconnect.'); }
  }
  function scheduleSave(next: S, delay = 1200) { clearTimeout(timer.current); timer.current = setTimeout(() => save(next), delay); }
  function commit(next: S, record = true) {
    if (record) { past.current.push(sRef.current); if (past.current.length > 100) past.current.shift(); future.current = []; }
    setS(next); dirty.current = true; setState('unsaved'); setQuote(null); scheduleSave(next); bump(x => x + 1);
  }
  const set = (patch: Partial<S>, record = true) => commit({ ...sRef.current, ...patch }, record);
  function undo() { const p = past.current.pop(); if (!p) return; future.current.push(sRef.current); setS(p); dirty.current = true; setState('unsaved'); setQuote(null); scheduleSave(p); bump(x => x + 1); }
  function redo() { const n = future.current.pop(); if (!n) return; past.current.push(sRef.current); setS(n); dirty.current = true; setState('unsaved'); setQuote(null); scheduleSave(n); bump(x => x + 1); }
  function onKey(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 5 : 0.5; const cur = sRef.current;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    const m: Record<string, Partial<S>> = { ArrowLeft: { offsetXMm: cur.offsetXMm - step }, ArrowRight: { offsetXMm: cur.offsetXMm + step }, ArrowUp: { offsetYMm: cur.offsetYMm - step }, ArrowDown: { offsetYMm: cur.offsetYMm + step } };
    if (m[e.key]) { e.preventDefault(); set(m[e.key]); }
  }
  async function upload(f: File) {
    setMsg(''); const fd = new FormData(); fd.append('file', f);
    try {
      const r = await fetch('/api/files', { method: 'POST', body: fd }); const b = await r.json();
      if (!r.ok) { setMsg(b.message, true); return; }
      setSourceId(b.fileId); setMsg(`${b.width}×${b.height}px ${b.format.toUpperCase()}. Colour profile: ${b.colourProfile === 'embedded' ? 'embedded' : 'none embedded, treated as sRGB'}.`); setQuote(null);
      past.current.push(sRef.current); await save(sRef.current, b.fileId);
    } catch { setMsg('Upload failed. Check your connection and try again.', true); }
  }
  async function getQuote() {
    if (state !== 'saved') { setMsg('Wait for the project to finish saving.', true); return; }
    const r = await fetch(`/api/projects/${id}/quote`, { method: 'POST' }); const b = await r.json();
    if (r.ok) setQuote(b); else setMsg(b.message, true);
  }
  async function reserve() {
    const r = await fetch(`/api/quotes/${quote.quoteId}/reserve`, { method: 'POST' }); const b = await r.json();
    if (r.ok) location.href = `/jobs/${b.jobId}`; else setMsg(b.message, true);
  }
  const num = (k: keyof S, label: string, step = 1, min?: number, max?: number) => <div><label htmlFor={k}>{label}</label>
    <input id={k} type="number" step={step} min={min} max={max} value={s[k] as number} onChange={e => { const v = Number(e.target.value); if (!Number.isNaN(v)) set({ [k]: min !== undefined && max !== undefined ? clamp(v, min, max) : v } as Partial<S>, false); }} onFocus={() => { editStart.current = sRef.current; }} onBlur={() => { const st = editStart.current; editStart.current = null; if (st && JSON.stringify(st) !== JSON.stringify(sRef.current)) { past.current.push(st); future.current = []; bump(x => x + 1); } }} /></div>;
  if (loading) return <main><p className="muted">Loading…</p></main>;
  const lvl = eff ? dpiLevel(eff) : null;
  const label = { saved: 'All changes saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Save failed', conflict: 'Save blocked: newer version exists', offline: 'Offline: not saved' }[state];
  return <main><h1>Prepare artwork</h1>
    <p aria-live="polite" role="status">{label}</p>
    <p role="alert" className={state === 'saved' && !bad ? 'muted' : 'err'}>{msg}</p>
    {meta.orgId && <div className="card">{meta.mine ? <label className="check"><input type="checkbox" checked={meta.visibility === 'shared'} onChange={async e => { const v = e.target.checked ? 'shared' : 'private'; const r = await fetch(`/api/projects/${id}/visibility`, { method: 'PATCH', headers: j, body: JSON.stringify({ visibility: v }) }); if (r.ok) setMeta(m => ({ ...m, visibility: v })); else setMsg((await r.json()).message, true); }} /> Share with everyone in the organisation (read-only)</label> : <p className="muted">Shared with you by a colleague. You can view it but not change it.</p>}</div>}
    <fieldset disabled={!meta.mine} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
    <div className="card"><label htmlFor="file">Image (JPG or PNG, up to 25 MB / 40 MP)</label>
      <input id="file" type="file" accept="image/jpeg,image/png" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
      {!sourceId && <p className="muted">No image yet.</p>}</div>
    {lvl === 'low' && <p role="alert" className="err">Print quality warning: at this size the image resolves to about {Math.round(eff!)} dpi (below {LOW_DPI_WARN}). It may look soft when printed.</p>}
    {lvl === 'ok' && <p className="muted">Effective resolution about {Math.round(eff!)} dpi: acceptable, not ideal.</p>}
    {lvl === 'good' && <p className="muted">Effective resolution about {Math.round(eff!)} dpi.</p>}
    <div className="card"><div className="bar">
      <button type="button" onClick={undo} disabled={!past.current.length}>Undo</button><button type="button" onClick={redo} disabled={!future.current.length}>Redo</button>
      <button type="button" onClick={() => setZoom(z => clamp(+(z - 0.25).toFixed(2), 0.5, 3))} aria-label="Zoom out">−</button><span aria-live="polite">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => setZoom(z => clamp(+(z + 0.25).toFixed(2), 0.5, 3))} aria-label="Zoom in">+</button>
      <button type="button" onClick={() => setZoom(1)}>Reset zoom</button></div>
      <div style={{ overflow: 'auto', maxWidth: '100%' }}><canvas ref={canvas} tabIndex={0} onKeyDown={onKey} onPointerDown={down} onPointerMove={moveP} onPointerUp={up} onPointerCancel={up} role="img" aria-label="Print preview. Drag to move the image, drag the square corner handle to resize. Arrow keys also move it, Shift for larger steps, Ctrl+Z to undo. The numeric fields below do the same." style={{ border: '1px solid var(--line)', maxWidth: 'none', touchAction: 'none', cursor: 'grab' }} /></div>
      <p className="muted">Drag the image to move it; drag the square corner handle to resize. Red line: trim. Green dashes: safe area. Tinted edge: bleed, filled by mirroring your image edges when exported. This is a preview; the exported file is produced on the server.</p></div>
    <details className="card" open><summary><strong>Size and output</strong></summary>
      <div className="grid"><div><label htmlFor="preset">Preset</label><select id="preset" value="" onChange={e => { const p = PRESETS[e.target.value]; if (p) set({ widthMm: p[0], heightMm: p[1] }); }}><option value="">Custom</option>{Object.keys(PRESETS).map(k => <option key={k}>{k}</option>)}</select></div>
        {num('widthMm', 'Width (mm)', 1, 1, 500)}{num('heightMm', 'Height (mm)', 1, 1, 500)}{num('bleedMm', 'Bleed (mm)', 0.5, 0, 20)}{num('dpi', 'Resolution (dpi)', 50, 72, 1200)}
        <div><label htmlFor="format">File format</label><select id="format" value={s.format} onChange={e => { const f = e.target.value as S['format']; set({ format: f, colour: f === 'tiff' || f === 'pdf' ? s.colour : 'rgb' }); }}><option value="png">PNG</option><option value="jpg">JPG</option><option value="tiff">TIFF</option><option value="pdf">PDF (single flattened page)</option></select></div>
        <div><label htmlFor="colour">Colour</label><select id="colour" value={s.colour} disabled={s.format === 'png' || s.format === 'jpg'} onChange={e => set({ colour: e.target.value as S['colour'] })}><option value="rgb">RGB (sRGB)</option><option value="cmyk">CMYK</option></select>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>{s.format === 'png' || s.format === 'jpg' ? 'PNG and JPG are always RGB. Choose TIFF or PDF for CMYK.' : s.colour === 'cmyk' ? 'Converted with the FOGRA39 coated profile and limited to 300% total ink. Colours on screen are an approximation. This is not a PDF/X file.' : 'Choose CMYK if your printer asks for CMYK files.'}</p></div>
        <div><label htmlFor="enhance">Enhance resolution</label><select id="enhance" value={s.enhance} onChange={e => { set({ enhance: e.target.value as S['enhance'] }); setEnhPrev(null); }}><option value="off">Off</option><option value="2x">2×</option><option value="4x">4×</option></select>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13 }}>Enlarges your image (OpenCV ESPCN model) before it is placed. It cannot bring back detail that is not in the picture, and on smooth images the result can be no better than a plain enlargement. Check the preview first.</p>
          {s.enhance !== 'off' && <p style={{ margin: '6px 0 0' }}><button type="button" className="btn" onClick={previewEnhance} disabled={enhBusy || !sourceId}>{enhBusy ? 'Making preview…' : 'Preview before and after'}</button></p>}
          {enhPrev && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }} role="group" aria-label="Enhancement before and after">
            <figure style={{ margin: 0 }}><img alt="Before: plain enlargement of the centre of your image" src={enhPrev.before} style={{ maxWidth: '100%', width: 192, imageRendering: 'pixelated' }} /><figcaption className="muted" style={{ fontSize: 13 }}>Before (plain enlargement)</figcaption></figure>
            <figure style={{ margin: 0 }}><img alt="After: enhanced enlargement of the same area" src={enhPrev.after} style={{ maxWidth: '100%', width: 192, imageRendering: 'pixelated' }} /><figcaption className="muted" style={{ fontSize: 13 }}>After ({enhPrev.factor}× enhanced)</figcaption></figure>
          </div>}</div></div></details>
    <details className="card" open><summary><strong>Position and fit</strong></summary>
      <div className="grid"><div><label htmlFor="fit">Placement</label><select id="fit" value={s.fit} onChange={e => set({ fit: e.target.value as S['fit'], offsetXMm: 0, offsetYMm: 0 })}><option value="fill">Fill (crop edges)</option><option value="fit">Fit (show all)</option></select></div>
        {num('scale', 'Scale (×)', 0.05, 0.05, 20)}{num('rotationDeg', 'Rotation (°)', 1, -360, 360)}{num('offsetXMm', 'Move across (mm)', 0.5)}{num('offsetYMm', 'Move down (mm)', 0.5)}</div>
      <div className="bar"><button type="button" onClick={() => set({ offsetXMm: 0 })}>Centre across</button><button type="button" onClick={() => set({ offsetYMm: 0 })}>Centre down</button>
        <button type="button" onClick={() => set({ offsetXMm: 0, offsetYMm: 0, rotationDeg: 0, scale: 1 })}>Reset position</button></div></details>
    <div className="card"><button onClick={getQuote} disabled={!sourceId || state === 'conflict'}>Get price</button>
      {quote && <p>Price ₹{(quote.customerAmountPaise / 100).toFixed(2)}, valid until {new Date(quote.expiresAt).toLocaleTimeString()}. <button onClick={reserve}>Hold funds and queue job</button></p>}</div>
    </fieldset>
  </main>;
}
