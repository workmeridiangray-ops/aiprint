'use client';
import { useState } from 'react';
const j = { 'content-type': 'application/json' };
async function call(url: string, method: string, body?: unknown, form?: FormData) {
  const r = await fetch(url, { method, headers: form ? undefined : j, body: form ?? (body ? JSON.stringify(body) : undefined) });
  if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
  const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.message ?? 'Request failed'); return b;
}
export default function Counter() {
  const [step, setStep] = useState(1); const [cc, setCc] = useState(''); const [pid, setPid] = useState(''); const [rev, setRev] = useState(1);
  const [quote, setQuote] = useState<any>(null); const [receipt, setReceipt] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setErr(''); setBusy(true); try { await fn(); } catch (e: any) { if (e.message !== 'auth') setErr(e.message); } setBusy(false); };
  return <main><h1>Counter work</h1><p role="alert" className="err">{err}</p>
    {step === 1 && <form className="card" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(async () => {
      const c = await call('/api/counter/customers', 'POST', { name: f.get('name'), contact: f.get('contact') }); setCc(c.id);
      const p = await call('/api/counter/projects', 'POST', { counterCustomerId: c.id, name: f.get('job') || 'Counter job' }); setPid(p.id); setRev(p.revision); setStep(2); }); }}>
      <h2>Customer</h2><label htmlFor="name">Customer name (required)</label><input id="name" name="name" required /><label htmlFor="contact">Phone or email (optional)</label><input id="contact" name="contact" />
      <label htmlFor="job">Job name</label><input id="job" name="job" /><button disabled={busy}>Continue</button></form>}
    {step === 2 && <form className="card" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(async () => {
      const fd = new FormData(); fd.append('file', f.get('file') as File); const up = await call('/api/files', 'POST', undefined, fd);
      const w = Number(f.get('w')), h = Number(f.get('h'));
      const s = await call(`/api/projects/${pid}`, 'PATCH', { revision: rev, sourceFileId: up.fileId, settings: { widthMm: w, heightMm: h, bleedMm: 3, dpi: 300, fit: 'fill', format: 'pdf' } });
      setRev(s.revision); setQuote(await call(`/api/projects/${pid}/quote`, 'POST')); setStep(3); }); }}>
      <h2>Artwork</h2><label htmlFor="file">Image (JPG or PNG)</label><input id="file" name="file" type="file" accept="image/jpeg,image/png" required />
      <div className="grid"><div><label htmlFor="w">Width (mm)</label><input id="w" name="w" type="number" defaultValue={210} min={1} max={500} required /></div><div><label htmlFor="h">Height (mm)</label><input id="h" name="h" type="number" defaultValue={297} min={1} max={500} required /></div></div>
      <button disabled={busy}>Get price</button></form>}
    {step === 3 && quote && <form className="card" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); run(async () => {
      const p = await call(`/api/counter/quotes/${quote.quoteId}/payment`, 'POST', { method: f.get('method'), amountPaise: quote.customerAmountPaise, reference: f.get('ref') });
      setReceipt(p.receiptNo); await call(`/api/counter/quotes/${quote.quoteId}/reserve`, 'POST'); setStep(4); }); }}>
      <h2>Payment</h2><p>Price to collect: <strong>₹{(quote.customerAmountPaise / 100).toFixed(2)}</strong> (valid until {new Date(quote.expiresAt).toLocaleTimeString()})</p>
      <p className="muted">Record money you have already taken from the customer. This is not processed by the platform.</p>
      <label htmlFor="method">Paid by</label><select id="method" name="method"><option value="cash">Cash</option><option value="upi_external">UPI (outside platform)</option><option value="card_external">Card machine (outside platform)</option><option value="other">Other</option></select>
      <label htmlFor="ref">Reference (optional)</label><input id="ref" name="ref" /><button disabled={busy}>Record payment and start processing</button></form>}
    {step === 4 && <div className="card" role="status"><h2>Receipt {receipt}</h2><p>Payment recorded. Processing has started.</p><button onClick={() => location.reload()}>New counter job</button></div>}
  </main>;
}
