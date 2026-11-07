'use client';
import { useEffect, useState } from 'react';
const j = { 'content-type': 'application/json' };
const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;
export default function Settings() {
  const [s, setS] = useState<any>(null); const [cl, setCl] = useState<any>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [why, setWhy] = useState(''); const [sure, setSure] = useState(false);
  async function load() { const [a, b] = await Promise.all([fetch('/api/vendor/settings'), fetch('/api/vendor/closure')]); if (a.status === 401) { location.href = '/login'; return; } const sa = await a.json(), sb = await b.json(); if (a.ok) setS(sa); else setErr(sa.message); if (b.ok) setCl(sb); }
  useEffect(() => { load(); }, []);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); setMsg(''); const f = new FormData(e.currentTarget);
    const r = await fetch('/api/vendor/settings', { method: 'PUT', headers: j, body: JSON.stringify({ billingContactName: f.get('bn'), billingEmail: f.get('be'), supportEmail: f.get('se'), supportPhone: f.get('sp'), requireStaffMfa: f.get('mfa') === 'on', expectedVersion: s.current?.version ?? 0 }) });
    const b = await r.json().catch(() => ({})); if (!r.ok) setErr(b.message ?? 'Request failed'); else setMsg(`Saved as version ${b.version}.`); load();
  }
  async function closeReq() { setErr(''); setMsg(''); const r = await fetch('/api/vendor/closure', { method: 'POST', headers: j, body: JSON.stringify({ reason: why }) }); const b = await r.json().catch(() => ({})); if (!r.ok) setErr(b.message ?? 'Request failed'); else { setMsg('Closure requested. Customers were told.'); setSure(false); } load(); }
  async function cancel() { setErr(''); setMsg(''); const r = await fetch('/api/vendor/closure/cancel', { method: 'POST' }); const b = await r.json().catch(() => ({})); if (!r.ok) setErr(b.message ?? 'Request failed'); else setMsg('Closure cancelled. Your store is open as before.'); load(); }
  const c = s?.current;
  return <main><h1>Store settings</h1><p><a href="/vendor">Back to your store</a></p>
    <p role="alert" className="err">{err}</p><p role="status" className="muted">{msg}</p>
    {!s ? <p className="muted">Loading…</p> : <>
      <section className="card"><h2>Contacts and sign-in</h2>
        <form onSubmit={save} key={c?.version ?? 0}>
          <label htmlFor="bn">Billing contact name</label><input id="bn" name="bn" defaultValue={c?.billingContactName ?? ''} maxLength={120} />
          <label htmlFor="be">Billing email</label><input id="be" name="be" type="email" defaultValue={c?.billingEmail ?? ''} maxLength={160} />
          <label htmlFor="se">Support email</label><input id="se" name="se" type="email" defaultValue={c?.supportEmail ?? ''} maxLength={160} />
          <label htmlFor="sp">Support phone</label><input id="sp" name="sp" defaultValue={c?.supportPhone ?? ''} maxLength={30} />
          <label className="check"><input type="checkbox" name="mfa" defaultChecked={!!c?.requireStaffMfa} /> Require two-step sign-in for all staff of this store</label>
          <p className="muted">{s.staffWithoutMfa} staff member{s.staffWithoutMfa === 1 ? ' has' : 's have'} not set up two-step sign-in yet. If you turn this on, they must set it up at their next sign-in.</p>
          <button>Save</button></form>
        <p className="muted">{c ? `Version ${c.version}, saved ${new Date(c.createdAt).toLocaleString()} by ${c.changedBy ?? 'unknown'}.` : 'Nothing saved yet.'}</p>
        {s.history.length > 1 && <details><summary>Earlier versions</summary>{s.history.slice(1).map((h: any) => <div key={h.version} className="muted">v{h.version} · {new Date(h.createdAt).toLocaleString()} · {h.changedBy ?? 'unknown'} · staff two-step {h.requireStaffMfa ? 'required' : 'not required'} · billing {h.billingEmail ?? 'none'} · support {h.supportEmail ?? 'none'}</div>)}</details>}</section>
      <section className="card"><h2>Close this store</h2>
        {cl?.tenantStatus === 'closing' && cl.closure ? <>
          <p role="status"><strong>Closure requested.</strong> New jobs are stopped. Your customers can still sign in and download files. The platform can complete the closure from {new Date(cl.closure.earliestCloseAt).toLocaleDateString('en-IN')}, once nothing is open.</p>
          <p>Reason you gave: {cl.closure.reason}</p>
          <p className="muted">Still open now: {cl.liabilities.activeJobs} job(s), {cl.liabilities.heldReservations} credit hold(s). Credit balances: processing {rs(cl.liabilities.balancesPaise.vendor_processing_credit)}, customers {rs(cl.liabilities.balancesPaise.customer_service_credit)}, organisations {rs(cl.liabilities.balancesPaise.organisation_service_credit)}. Money is settled outside this system.</p>
          <button type="button" onClick={cancel}>Cancel closure and keep my store</button></>
        : cl?.tenantStatus === 'active' ? <>
          <p className="muted">Closing stops new jobs straight away and tells your customers. The store stays reachable for at least {cl.noticeDays} days so they can download files. After closing, files are deleted after a further delay; payment and audit records are kept. You can cancel until the platform completes it.</p>
          <label htmlFor="why">Why are you closing?</label><input id="why" value={why} maxLength={300} onChange={e => setWhy(e.target.value)} />
          <label className="check"><input type="checkbox" checked={sure} onChange={e => setSure(e.target.checked)} /> I understand new jobs stop immediately</label>
          <button type="button" disabled={!sure || why.trim().length < 5} onClick={closeReq}>Request closure</button></>
        : <p className="muted">Store status: {cl?.tenantStatus}.</p>}
      </section></>}
  </main>;
}
