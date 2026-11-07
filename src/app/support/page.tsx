'use client';
import { useEffect, useState } from 'react';
const j = { 'content-type': 'application/json' };
const CATS: Record<string, string> = { file_or_job: 'A file or a job', payment: 'A payment or credit', account: 'My account', deletion: 'Deleting my files or data', other: 'Something else' };
const STATUS: Record<string, string> = { open: 'Open', awaiting_requester: 'Waiting for you', escalated: 'With platform support', resolved: 'Resolved', closed: 'Closed' };
export default function Support() {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [link, setLink] = useState<{ type: string; id: string } | null>(null);
  async function load() { const r = await fetch('/api/support'); if (r.status === 401) { location.href = '/login'; return; } if (r.ok) setRows(await r.json()); else setErr((await r.json()).message); }
  useEffect(() => { const q = new URLSearchParams(location.search); const t = q.get('type'), id = q.get('id'); if (t && id) setLink({ type: t, id }); load(); }, []);
  async function create(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setBusy(true); const f = new FormData(e.currentTarget);
    const r = await fetch('/api/support', { method: 'POST', headers: j, body: JSON.stringify({ category: f.get('category'), subject: f.get('subject'), body: f.get('body'), linkType: link?.type ?? null, linkId: link?.id ?? null }) });
    const b = await r.json().catch(() => ({})); setBusy(false);
    if (r.ok) location.href = `/support/${b.id}`; else setErr(b.message ?? 'Could not create the ticket');
  }
  return <main><h1>Help and support</h1><p role="alert" className="err">{err}</p>
    <section className="card"><h2>Ask for help</h2>
      {link && <p className="muted">This ticket will be linked to your {link.type}. <a href="/support" onClick={() => setLink(null)}>Remove link</a></p>}
      <form onSubmit={create}>
        <label htmlFor="cat">What is it about?</label><select id="cat" name="category" defaultValue={link?.type === 'output' ? 'file_or_job' : 'other'}>{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <label htmlFor="sub">Subject</label><input id="sub" name="subject" required minLength={3} maxLength={150} />
        <label htmlFor="bod">What happened?</label><textarea id="bod" name="body" rows={5} required maxLength={5000} style={{ width: '100%' }} />
        <button disabled={busy}>{busy ? 'Sending…' : 'Send'}</button></form></section>
    <h2>Your tickets</h2>
    {rows === null ? <p className="muted">Loading…</p> : rows.length === 0 ? <div className="card">No tickets yet.</div> :
      <table><thead><tr><th>Reference</th><th>Subject</th><th>Status</th><th>Updated</th></tr></thead><tbody>{rows.map(t => <tr key={t.id}><td><a href={`/support/${t.id}`}>{t.reference}</a></td><td>{t.subject}{t.mine ? '' : <span className="muted"> (customer)</span>}</td><td data-status={t.status}>{STATUS[t.status]}</td><td>{new Date(t.updatedAt).toLocaleString()}</td></tr>)}</tbody></table>}
    <p><a href="/account/data">Download or delete my data</a> · <a href="/projects">Back</a></p></main>;
}
