'use client';
import { useState } from 'react';
export default function EnquiryForm() {
  const [errs, setErrs] = useState<Record<string, string>>({}); const [top, setTop] = useState(''); const [ref, setRef] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErrs({}); setTop('');
    const f = new FormData(e.currentTarget);
    try {
      const r = await fetch('/api/enquiries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: f.get('name'), email: f.get('email'), subject: f.get('subject'), message: f.get('message'), consent: f.get('consent') === 'on', website: f.get('website') }) });
      const b = await r.json();
      if (r.ok) setRef(b.reference); else if (b.fields) { setErrs(b.fields); setTop(b.message); } else setTop(b.message ?? 'Something went wrong. Please try again.');
    } catch { setTop('Could not reach the server. Check your connection and try again; your message is still in the form.'); }
    setBusy(false);
  }
  if (ref) return <div className="card" role="status"><h2>Thank you</h2><p>We have your enquiry. Your reference is <strong>{ref}</strong>. Quote it if you write to us again.</p></div>;
  const err = (k: string) => errs[k] ? <p id={`${k}-err`} className="err">{errs[k]}</p> : null;
  const a = (k: string) => ({ 'aria-invalid': !!errs[k], 'aria-describedby': errs[k] ? `${k}-err` : undefined });
  return <form onSubmit={submit} noValidate className="card" style={{ maxWidth: 560 }}>
    {top && <p role="alert" className="err">{top}</p>}
    <label htmlFor="name">Your name</label><input id="name" name="name" autoComplete="name" required {...a('name')} />{err('name')}
    <label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required {...a('email')} />{err('email')}
    <label htmlFor="subject">Subject</label><input id="subject" name="subject" required {...a('subject')} />{err('subject')}
    <label htmlFor="message">Message</label><textarea id="message" name="message" rows={6} maxLength={4000} required {...a('message')} />{err('message')}
    <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }}><label htmlFor="website">Leave this empty</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
    <label className="check"><input type="checkbox" name="consent" {...a('consent')} /> I agree that you may use these details to reply to my enquiry.</label>{err('consent')}
    <button disabled={busy}>{busy ? 'Sending…' : 'Send enquiry'}</button></form>;
}
