'use client';
import { useEffect, useState } from 'react';
const j = { 'content-type': 'application/json' };
const rupees = (p: number) => `₹${(p / 100).toFixed(2)}`;
async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: j, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
  const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.message ?? 'Request failed'); return b;
}
export default function Business() {
  const [orgs, setOrgs] = useState<any[] | null>(null); const [data, setData] = useState<any>(null); const [usage, setUsage] = useState<any>(null);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [denied, setDenied] = useState(false);
  const org = orgs?.[0];
  async function load() {
    try { const o = await call('/api/orgs', 'GET'); setOrgs(o); if (o[0]) {
      try { const [m, u] = await Promise.all([call(`/api/orgs/${o[0].id}/members`, 'GET'), call(`/api/orgs/${o[0].id}/usage`, 'GET')]); setData(m); setUsage(u); setDenied(false); } catch (e: any) { if (e.message === 'auth') throw e; setDenied(true); } }
    } catch (e: any) { if (e.message !== 'auth') setErr(e.message); }
  }
  useEffect(() => { load(); }, []);
  async function act(fn: () => Promise<unknown>, ok: string) { setMsg(''); setErr(''); try { await fn(); setMsg(ok); await load(); } catch (e: any) { if (e.message !== 'auth') setErr(e.message); } }
  const form = (fn: (f: FormData) => Promise<unknown>, ok: string) => (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); act(() => fn(f), ok); };
  return <main><h1>Your organisation</h1><p role="status" className="muted">{msg}</p><p role="alert" className="err">{err}</p>
    {orgs === null && !err && <p className="muted">Loading…</p>}
    {orgs && !org && <form className="card" onSubmit={form(f => call('/api/orgs', 'POST', { name: f.get('name'), billingContact: f.get('contact') }), 'Organisation created.')}>
      <p>Set up an organisation to share credit with up to nine colleagues. You will be its administrator.</p>
      <label htmlFor="name">Organisation name</label><input id="name" name="name" required /><label htmlFor="contact">Billing contact (optional)</label><input id="contact" name="contact" /><button>Create organisation</button></form>}
    {org && denied && <div className="card"><h2>{org.name}</h2><p>You are a member of this organisation. You can create projects inside it from your project list; spending is limited by the administrator.</p></div>}
    {org && data && <>
      <div className="card"><h2>{org.name}</h2><div className="grid"><div><strong>{rupees(data.balance.available)}</strong><div className="muted">Shared credit available</div></div>
        <div><strong>{rupees(data.balance.held)}</strong><div className="muted">Held for running jobs</div></div><div><strong>{data.seats.used} of {data.seats.limit}</strong><div className="muted">Seats including invitations</div></div></div>
        <p className="muted">Member limits are controls on this shared credit. They are not extra money.</p></div>
      <div className="card"><h2>Members</h2><div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th align="left">Email</th><th align="left">Role</th><th align="left">Monthly limit (₹)</th><th align="left">Spent</th><th align="left">Reserved</th><th /></tr></thead><tbody>
        {data.members.map((m: any) => <tr key={m.id}><td>{m.email}</td><td>{m.role}</td>
          <td>{m.role === 'admin' ? <span className="muted">none</span> : <form style={{ display: 'flex', gap: 6 }} onSubmit={form(f => call(`/api/orgs/${org.id}/members/${m.id}`, 'PATCH', { monthlyLimitPaise: f.get('limit') === '' ? null : Math.round(Number(f.get('limit')) * 100) }), 'Limit saved.')}>
            <input aria-label={`Monthly limit for ${m.email}`} name="limit" type="number" min="0" step="0.01" defaultValue={m.monthlyLimitPaise === null ? '' : m.monthlyLimitPaise / 100} placeholder="No limit" style={{ width: 110 }} /><button style={{ marginTop: 0 }}>Save</button></form>}</td>
          <td>{rupees(m.spentPaise)}</td><td>{rupees(m.reservedPaise)}</td>
          <td>{m.role === 'member' && <><button style={{ marginTop: 0 }} onClick={() => confirm(`Make ${m.email} the administrator? You will become a member.`) && act(() => call(`/api/orgs/${org.id}/transfer`, 'POST', { memberId: m.id }), 'Administrator changed.')}>Make admin</button>{' '}
            <button style={{ marginTop: 0 }} onClick={() => confirm(`Remove ${m.email}?`) && act(() => call(`/api/orgs/${org.id}/members/${m.id}`, 'DELETE'), 'Member removed.')}>Remove</button></>}</td></tr>)}</tbody></table></div>
        <form onSubmit={form(f => call(`/api/orgs/${org.id}/invite`, 'POST', { email: f.get('email') }), 'Invitation queued. They must have an account in this store.')}>
          <label htmlFor="iemail">Invite by email</label><input id="iemail" name="email" type="email" required /><button>Send invitation</button></form></div>
      <div className="card"><h2>Usage</h2>
        <p><a href={`/api/orgs/${org.id}/usage?format=csv`}>Download CSV</a> <span className="muted">Shows charges only. It does not give access to members' private artwork.</span></p>
        {usage.rows.length === 0 ? <p className="muted">No usage yet.</p> : <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th align="left">Date</th><th align="left">Member</th><th align="left">Project</th><th align="left">Amount</th><th align="left">Status</th></tr></thead><tbody>
          {usage.rows.map((r: any, i: number) => <tr key={i}><td>{new Date(r.date).toLocaleString()}</td><td>{r.member}</td><td>{r.project}</td><td>{rupees(r.amountPaise)}</td><td>{r.status === 'held' ? 'reserved' : 'spent'}</td></tr>)}</tbody></table></div>}</div></>}
  </main>;
}
