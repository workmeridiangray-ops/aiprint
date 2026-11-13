'use client';
import { useEffect, useState } from 'react';
import { call, rs, when, words, useAct, Badge } from '../ui';
const REASON: Record<string, string> = { topup: 'Payment received', job_consumed: 'Artwork job', refund_credit: 'Refund (as credit)', refund_hold: 'Being returned to your bank', refund_hold_reversed: 'Return to bank did not go through', adjustment: 'Correction by support', test_seed: 'Test credit' };
const PURPOSE: Record<string, string> = { customer_topup: 'Credit top-up', org_topup: 'Organisation top-up', vendor_topup: 'Processing credit', subscription: 'Subscription' };
export default function Credits() {
  const [m, setM] = useState<any>(null); const [refunds, setRefunds] = useState<any[]>([]); const [back, setBack] = useState<string | null>(null);
  async function load() { const [a, r] = await Promise.all([call('/api/money'), call('/api/refunds').catch(() => [])]); setM(a); setRefunds(r); }
  const { form, busy, Notice, setErr } = useAct(load);
  useEffect(() => { load().catch(e => { if (e.message !== 'auth') setErr(e.message === 'Not permitted' ? 'This page is for customers. Store staff use Billing.' : e.message); }); }, []);
  async function pay(f: FormData) {
    const [kind, orgId] = String(f.get('account')).split(':');
    const p = await call('/api/payments', 'POST', { purpose: kind === 'org' ? 'org_topup' : 'customer_topup', orgId: orgId || undefined, amountPaise: Math.round(Number(f.get('amount')) * 100) });
    location.href = `/pay/${p.paymentId}`;
  }
  return <main><h1>Credit and payments</h1><Notice />
    {!m ? <p className="muted">Loading…</p> : <>
      {m.provider.testMode && <p className="testmode"><strong>Test mode.</strong> Payments here are simulated. No real money moves.</p>}
      <section className="card"><h2>Balances</h2><div className="grid">{m.accounts.map((a: any) => <div className="stat" key={a.id}><strong>{rs(a.availablePaise)}</strong><span className="muted">{a.label}{a.heldPaise ? ` · ${rs(a.heldPaise)} on hold for jobs in progress` : ''}</span></div>)}</div>
        <p className="muted">₹1 of credit pays for ₹1 of service. Credit does not expire.</p></section>
      <section className="card"><h2>Add credit</h2>
        {!m.provider.available ? <p className="muted">Online payment is not available yet. {m.provider.message}</p> : <form onSubmit={form(pay, '', false)}><div className="inline">
          {m.accounts.length > 1 && <div><label htmlFor="acc">Add to</label><select id="acc" name="account">{m.accounts.map((a: any) => <option key={a.id} value={`${a.kind}:${a.orgId ?? ''}`}>{a.label}</option>)}</select></div>}
          {m.accounts.length === 1 && <input type="hidden" name="account" value="customer:" />}
          <div><label htmlFor="amt">Amount (₹{m.limits.customerMin / 100} to ₹{(m.limits.customerMax / 100).toLocaleString('en-IN')})</label><input id="amt" name="amount" type="number" min={m.limits.customerMin / 100} max={m.limits.customerMax / 100} step="1" required defaultValue={500} /></div>
          <button disabled={busy}>Continue to payment</button></div><p className="muted">You will see the amount again before paying. Credit is added only after the payment provider confirms it.</p></form>}</section>
      <section className="card"><h2>Payments</h2>{m.payments.length === 0 ? <p className="muted">No payments yet.</p> : <div className="scroll"><table><thead><tr><th>Date</th><th>For</th><th className="num">Amount</th><th>Status</th><th></th></tr></thead><tbody>
        {m.payments.map((p: any) => <tr key={p.id}><td>{when(p.createdAt)}</td><td>{PURPOSE[p.purpose]}</td><td className="num">{rs(p.amountPaise)}</td><td><Badge s={p.status} /></td>
          <td>{['pending', 'created'].includes(p.status) && <a href={`/pay/${p.id}`}>Continue</a>}{p.status === 'success' && p.purpose === 'customer_topup' && <button type="button" className="secondary" onClick={() => setBack(back === p.id ? null : p.id)}>Return unused credit</button>}</td></tr>)}</tbody></table></div>}
        {back && <form onSubmit={form(async f => { await call('/api/refunds', 'POST', { kind: 'unused_credit', paymentId: back, amountPaise: Math.round(Number(f.get('amount')) * 100), reason: f.get('reason') }); setBack(null); }, 'Request sent. You will be told when it is approved and again when the money has been returned.')}>
          <h3>Return unused credit to your bank</h3><p className="muted">Only credit you have not spent can be returned, and only up to the amount of this payment. It goes back the way you paid.</p>
          <div className="inline"><div><label htmlFor="ramt">Amount (₹)</label><input id="ramt" name="amount" type="number" min="1" step="0.01" required /></div><div style={{ flex: '3 1 260px' }}><label htmlFor="rwhy">Reason</label><input id="rwhy" name="reason" minLength={10} maxLength={500} required /></div><button disabled={busy}>Send request</button></div></form>}</section>
      {refunds.length > 0 && <section className="card"><h2>Refund requests</h2><div className="scroll"><table><thead><tr><th>Reference</th><th>Date</th><th>Type</th><th className="num">Amount</th><th>Status</th><th>Note</th></tr></thead><tbody>
        {refunds.map(r => <tr key={r.id}><td>{r.reference}</td><td>{when(r.createdAt)}</td><td>{r.kind === 'job_charge' ? `Job charge, ${r.method === 'credit' ? 'as credit' : 'to bank'}` : 'Unused credit, to bank'}</td><td className="num">{rs(r.amountPaise)}</td><td><Badge s={r.status} /></td><td>{r.status === 'approved' ? 'Approved, not yet returned' : r.note ?? ''}</td></tr>)}</tbody></table></div></section>}
      {m.accounts.map((a: any) => <section className="card" key={a.id}><h2>Statement: {a.label}</h2>{a.entries.length === 0 ? <p className="muted">Nothing yet.</p> : <div className="scroll"><table><thead><tr><th>Date</th><th>What</th><th className="num">Amount</th></tr></thead><tbody>
        {a.entries.map((e: any, i: number) => <tr key={i}><td>{when(e.at)}</td><td>{REASON[e.reason] ?? words(e.reason)}</td><td className="num">{rs(e.amountPaise)}</td></tr>)}</tbody></table></div>}</section>)}
    </>}
    <p><a href="/projects">Back to your artwork</a> · <a href="/library">Your files</a> · <a href="/support">Help</a></p></main>;
}
