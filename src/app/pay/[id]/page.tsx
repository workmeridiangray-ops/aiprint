'use client';
import { useEffect, useState, use } from 'react';
import { call, rs, Badge } from '../../ui';
const PURPOSE: Record<string, string> = { customer_topup: 'Credit top-up', org_topup: 'Organisation credit top-up', vendor_topup: 'Processing credit top-up', subscription: 'Store subscription (one month)' };
const DONE: Record<string, string> = { success: 'Payment received. It has been added to your account.', failed: 'The payment did not go through. Nothing was added and nothing is owed.', expired: 'This payment was not completed in time. If money left your bank, it will be matched automatically; you do not need to pay again yet.', quarantined: 'The payment provider reported something unexpected about this payment. It is with our finance team and nothing has been added yet. You do not need to pay again.' };
/** Payment page. The status shown always comes from the server's own record, which changes only when the payment provider confirms: returning to this page proves nothing. */
export default function Pay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const [p, setP] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [waiting, setWaiting] = useState(false);
  const load = async () => { try { const b = await call(`/api/payments/${id}`); setP(b); return b; } catch (e: any) { if (e.message !== 'auth') setErr(e.message); return null; } };
  useEffect(() => { load(); }, [id]);
  useEffect(() => { if (!waiting || !p || p.status !== 'pending') return; const t = setTimeout(load, 3000); return () => clearTimeout(t); }, [waiting, p]);
  const back = p?.purpose === 'vendor_topup' || p?.purpose === 'subscription' ? '/vendor/billing' : '/credits';
  async function sandbox(outcome: string) { if (busy) return; setBusy(true); setErr(''); try { await call(`/api/payments/${id}/sandbox`, 'POST', { outcome }); await load(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); } }
  function razorpay() {
    setErr(''); const open = () => { const rz = new (window as any).Razorpay({ key: p.publicKey, order_id: p.orderId, amount: p.amountPaise, currency: p.currency, name: 'Artwork Studio', description: PURPOSE[p.purpose], handler: () => { setWaiting(true); load(); }, modal: { ondismiss: () => { setWaiting(true); load(); } } }); rz.open(); };
    if ((window as any).Razorpay) return open();
    const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = open; s.onerror = () => setErr('The payment window could not be loaded. Check your connection and try again.'); document.body.appendChild(s);
  }
  return <main><div className="card" style={{ maxWidth: 460, margin: '40px auto' }}><h1>Payment</h1><p role="alert" className="err">{err}</p>
    {!p ? !err && <p className="muted">Loading…</p> : <div aria-live="polite">
      {p.testMode && <p className="testmode"><strong>Test mode.</strong> This is a simulated payment. No real money moves.</p>}
      <dl><dt>For</dt><dd>{PURPOSE[p.purpose]}</dd><dt>Amount</dt><dd className="price">{rs(p.amountPaise)}</dd><dt>Status</dt><dd><Badge s={p.status} /></dd><dt>Reference</dt><dd className="muted" style={{ wordBreak: 'break-all' }}>{p.id}</dd></dl>
      {p.status === 'pending' && p.provider === 'sandbox' && <><p>Choose how the simulated payment ends:</p><div className="bar"><button disabled={busy} onClick={() => sandbox('success')}>Simulate a successful payment</button><button disabled={busy} className="secondary" onClick={() => sandbox('failed')}>Simulate a failed payment</button></div></>}
      {p.status === 'pending' && p.provider === 'razorpay' && !waiting && <button onClick={razorpay}>Pay {rs(p.amountPaise)}</button>}
      {p.status === 'pending' && waiting && <p>Checking with the payment provider… <button type="button" className="secondary" onClick={load}>Check again</button><br /><span className="muted">If you paid, it is safe to leave this page: the payment is matched automatically. Do not pay twice.</span></p>}
      {DONE[p.status] && <p><strong>{DONE[p.status]}</strong></p>}
      <p><a href={back}>{p.status === 'pending' ? 'Cancel and go back' : 'Continue'}</a></p></div>}
  </div></main>;
}
