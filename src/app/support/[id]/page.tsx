'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
const j = { 'content-type': 'application/json' };
const STATUS: Record<string, string> = { open: 'Open', awaiting_requester: 'Waiting for the customer', escalated: 'With platform support', resolved: 'Resolved', closed: 'Closed' };
export default function Ticket() {
  const { id } = useParams<{ id: string }>(); const [t, setT] = useState<any>(null); const [err, setErr] = useState(''); const [mode, setMode] = useState<'reply' | 'note'>('reply');
  async function load() { const r = await fetch(`/api/support/${id}`); if (r.status === 401) { location.href = '/login'; return; } const b = await r.json(); if (r.ok) setT(b); else setErr(b.message); }
  useEffect(() => { load(); }, [id]);
  async function act(action: string, body: object = {}) { setErr(''); const r = await fetch(`/api/support/${id}/${action}`, { method: 'POST', headers: j, body: JSON.stringify(body) }); if (!r.ok) setErr((await r.json()).message); else await load(); }
  const f = (fn: (d: FormData) => Promise<void>) => (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const form = e.currentTarget; fn(new FormData(form)).then(() => form.reset()); };
  if (!t) return <main><p role="alert" className="err">{err}</p>{!err && <p className="muted">Loading…</p>}<a href="/support">Back</a></main>;
  const staff = t.viewerRole !== 'requester'; const done = t.status === 'resolved' || t.status === 'closed';
  return <main><p><a href="/support">← All tickets</a></p><h1>{t.subject}</h1>
    <p className="muted">{t.reference} · {STATUS[t.status]}{t.link ? ` · linked ${t.link.type}` : ''}{staff && t.requesterEmail ? ` · ${t.requesterEmail}` : ''}</p><p role="alert" className="err">{err}</p>
    {t.status === 'resolved' && <div className="card"><strong>Resolved.</strong> {t.resolution}<div className="muted">Evidence: {t.evidence}</div></div>}
    {t.messages.map((m: any) => <div className="card" key={m.id} data-kind={m.kind} style={m.kind === 'internal' ? { background: '#fff8e6' } : undefined}>
      <span className="muted">{m.kind === 'internal' ? 'Staff note (not visible to the customer) · ' : ''}{m.from === 'you' ? 'You' : m.from === 'system' ? 'System' : m.from} · {new Date(m.at).toLocaleString()}</span><div style={{ whiteSpace: 'pre-wrap' }}>{m.body}</div></div>)}
    {!done && <section className="card"><form onSubmit={f(d => act(mode === 'note' ? 'note' : 'reply', { body: d.get('body') }))}>
      {staff && <div className="bar"><label><input type="radio" checked={mode === 'reply'} onChange={() => setMode('reply')} /> Reply to customer</label><label><input type="radio" checked={mode === 'note'} onChange={() => setMode('note')} /> Staff note</label></div>}
      <label htmlFor="msg">{mode === 'note' ? 'Staff note' : 'Your message'}</label><textarea id="msg" name="body" rows={4} required style={{ width: '100%' }} /><button>{mode === 'note' ? 'Add note' : 'Send reply'}</button></form></section>}
    {staff && !done && <section className="card"><h2>Handling</h2>
      {t.assignable?.length > 0 && <form className="bar" onSubmit={f(d => act('assign', { assigneeId: d.get('who') }))}><label htmlFor="who">Assign to</label><select id="who" name="who" defaultValue={t.assigneeId ?? ''}>{t.assignable.map((u: any) => <option key={u.id} value={u.id}>{u.email}</option>)}</select><button>Assign</button></form>}
      {t.owners && <form onSubmit={f(d => act('escalate', { reason: d.get('reason'), ownerId: d.get('owner') }))}><label htmlFor="own">Platform owner of the next step</label><select id="own" name="owner">{t.owners.map((u: any) => <option key={u.id} value={u.id}>{u.email}</option>)}</select>
        <label htmlFor="why">Why does this need platform support?</label><input id="why" name="reason" required minLength={10} /><button>Escalate</button></form>}
      {t.escalated && t.escalationReason && <p className="muted">Escalated: {t.escalationReason}</p>}
      <form onSubmit={f(d => act('resolve', { resolution: d.get('res'), evidence: d.get('ev') }))}><label htmlFor="res">What was done</label><input id="res" name="res" required minLength={5} /><label htmlFor="ev">Evidence (what you checked or a reference)</label><input id="ev" name="ev" required minLength={10} /><button>Mark resolved</button></form></section>}
    {t.status === 'resolved' && t.viewerRole === 'requester' && <div className="bar"><button onClick={() => act('close')}>This fixed it: close</button></div>}
    {t.canReopen && <div className="bar"><button onClick={() => act('reopen')}>Reopen</button></div>}
  </main>;
}
