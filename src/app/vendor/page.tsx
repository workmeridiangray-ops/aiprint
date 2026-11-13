'use client';
import { useEffect, useState } from 'react';
const j = { 'content-type': 'application/json' };
const rupees = (p: number) => `₹${(p / 100).toFixed(2)}`;
async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: j, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
  const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.message ?? 'Request failed'); return b;
}
export default function Vendor() {
  const [ov, setOv] = useState<any>(null); const [staff, setStaff] = useState<any>(null); const [pr, setPr] = useState<any>(null);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  async function load() {
    try { const [o, s, p] = await Promise.all([call('/api/vendor/overview', 'GET'), call('/api/vendor/staff', 'GET').catch(() => null), call('/api/vendor/pricing', 'GET').catch(() => null)]); setOv(o); setStaff(s); setPr(p?.pricing ?? null); setErr(''); }
    catch (e: any) { if (e.message !== 'auth') setErr(e.message); }
  }
  useEffect(() => { load(); }, []);
  async function act(fn: () => Promise<unknown>, ok: string) { setMsg(''); setErr(''); try { await fn(); setMsg(ok); await load(); } catch (e: any) { if (e.message !== 'auth') setErr(e.message); } }
  const form = (fn: (f: FormData) => Promise<unknown>, ok: string) => (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); act(() => fn(f), ok); };
  return <main><h1>Your store</h1><p role="status" className="muted">{msg}</p><p role="alert" className="err">{err}</p>
    {!ov && !err ? <p className="muted">Loading…</p> : ov && <div className="card"><div className="grid">
      <div><strong>{ov.customers}</strong><div className="muted">Customers</div></div>
      <div><strong>{rupees(ov.processingCredit.available)}</strong><div className="muted">Processing credit available</div></div>
      <div><strong>{ov.subscription?.status ?? 'none'}</strong><div className="muted">Subscription{ov.subscription?.period_end ? ` until ${new Date(ov.subscription.period_end).toLocaleDateString()}` : ''}</div></div>
      <div><strong>{ov.counterPayments.count}</strong><div className="muted">Counter payments ({rupees(ov.counterPayments.totalPaise)}), recorded outside the platform</div></div></div>
      <p><a href="/vendor/billing">Billing, credit and settlements</a> · <a href="/vendor/customers">Customers</a> · <a href="/vendor/reports">Reports</a> · <a href="/vendor/settings">Settings and closure</a> · <a href="/vendor/claims">Walk-in claims{ov.claimsWaiting ? ` (${ov.claimsWaiting} waiting)` : ''}</a></p>
      {ov.storage && <p className={ov.storage.over ? 'err' : 'muted'} role={ov.storage.over ? 'alert' : undefined}>Storage used: {(ov.storage.usedBytes / 1048576).toFixed(1)} MB{ov.storage.quotaBytes ? ` of ${Math.round(ov.storage.quotaBytes / 1048576)} MB` : ' (no limit on your plan)'}.{ov.storage.over ? ' Your allowance is full: new uploads and new work are paused until files are deleted or the plan changes. Existing files can still be downloaded.' : ''}</p>}
      {Object.keys(ov.jobsByStatus).length === 0 ? <p className="muted">No jobs yet.</p> : <p className="muted">Jobs: {Object.entries(ov.jobsByStatus).map(([k, v]) => `${k} ${v}`).join(', ')}</p>}</div>}
    <details className="card" open><summary><strong>Customer prices</strong></summary>
      <p className="muted">{pr ? `Current: ${rupees(Number(pr.per_mp_paise))} per megapixel, minimum ${rupees(Number(pr.min_paise))}.` : 'No prices set yet. Customers cannot get a quote until you set them.'}</p>
      <form onSubmit={form(f => call('/api/vendor/pricing', 'PUT', { perMpPaise: Math.round(Number(f.get('perMp')) * 100), minPaise: Math.round(Number(f.get('min')) * 100) }), 'Prices saved. Existing accepted quotes keep their price.')}>
        <div className="grid"><div><label htmlFor="perMp">Price per megapixel (₹)</label><input id="perMp" name="perMp" type="number" step="0.01" min="0" required /></div>
          <div><label htmlFor="min">Minimum per job (₹)</label><input id="min" name="min" type="number" step="0.01" min="0" required /></div></div><button>Save prices</button></form></details>
    <details className="card"><summary><strong>Branding</strong></summary>
      <form onSubmit={form(f => call('/api/vendor/branding', 'PATCH', { displayName: f.get('name') || undefined, primaryColour: f.get('colour') || undefined }), 'Branding saved.')}>
        <label htmlFor="name">Store name</label><input id="name" name="name" /><label htmlFor="colour">Accent colour</label><input id="colour" name="colour" type="color" defaultValue="#0f5f63" /><button>Save branding</button></form></details>
    {staff && <details className="card" open><summary><strong>Staff ({staff.seats.used}{Number.isFinite(staff.seats.limit) ? ` of ${staff.seats.limit}` : ''} seats)</strong></summary>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th align="left">Email</th><th align="left">Role</th><th /></tr></thead><tbody>
        {staff.staff.map((m: any) => <tr key={m.id}><td>{m.email}</td><td><select aria-label={`Role for ${m.email}`} value={m.role} onChange={e => act(() => call(`/api/members/${m.id}/role`, 'POST', { role: e.target.value }), 'Role updated.')}>
          {['vendor_admin', 'vendor_counter', 'vendor_support', 'vendor_finance'].map(r => <option key={r} value={r}>{r.replace('vendor_', '')}</option>)}</select></td>
          <td><button onClick={() => act(() => call(`/api/members/${m.id}/revoke`, 'POST'), 'Member removed.')}>Remove</button></td></tr>)}</tbody></table>
      <form onSubmit={form(f => call('/api/members/invite', 'POST', { email: f.get('email'), role: f.get('role') }), 'Invitation queued.')}>
        <div className="grid"><div><label htmlFor="iemail">Invite by email</label><input id="iemail" name="email" type="email" required /></div>
          <div><label htmlFor="irole">Role</label><select id="irole" name="role"><option value="vendor_counter">counter</option><option value="vendor_support">support</option><option value="vendor_finance">finance</option><option value="vendor_admin">admin</option></select></div></div><button>Send invitation</button></form></details>}
  </main>;
}
