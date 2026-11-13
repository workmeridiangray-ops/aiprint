'use client';
import { useEffect, useState } from 'react';
import { call, rs, when, day, words, useAct, Badge, CodeField } from '../../ui';

const TABS = ['Stores', 'People', 'Staff', 'Direct store', 'Configuration', 'Incidents'] as const;
type Tab = typeof TABS[number];
const ROLE: Record<string, string> = { platform_owner: 'Owner', platform_finance: 'Finance', platform_support: 'Support' };
const STEP: Record<string, string> = { contained: 'Mark contained', restored: 'Record restore', reconciled: 'Record reconciliation', reopened: 'Approve reopening', closed: 'Close' };

export default function Operations() {
  const [tab, setTab] = useState<Tab>('Stores'); const [d, setD] = useState<any>({}); const [denied, setDenied] = useState(''); const [store, setStore] = useState<any>(null); const [people, setPeople] = useState<any[] | null>(null); const [q, setQ] = useState('');
  async function load() {
    const get = async (k: string, url: string) => { const v = await call(url); setD((x: any) => ({ ...x, [k]: v })); };
    setDenied('');
    if (tab === 'Stores') { await get('overview', '/api/platform/overview'); if (store) setStore(await call(`/api/platform/tenants/${store.id}`)); }
    if (tab === 'People' && q.trim().length >= 3) setPeople(await call(`/api/platform/people?q=${encodeURIComponent(q.trim())}`));
    if (tab === 'Staff') await get('staff', '/api/platform/staff');
    if (tab === 'Direct store') await get('direct', '/api/platform/direct');
    if (tab === 'Configuration') await get('config', '/api/platform/config');
    if (tab === 'Incidents') await get('incidents', '/api/platform/incidents');
  }
  const { act, form, busy, Notice, setErr } = useAct(load);
  useEffect(() => { load().catch(e => { if (e.status === 403) setDenied(tab); else if (e.message !== 'auth') setErr(e.message); }); }, [tab]);
  const stores: any[] = d.overview?.tenants ?? d.overview?.stores ?? [];
  return <main className="wide"><h1>Operations</h1><p><a href="/admin">Administration</a> · <a href="/admin/finance">Finance</a> · <a href="/account/security">Security</a></p>
    <div className="tabs" role="tablist">{TABS.map(x => <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)}>{x}</button>)}</div><Notice />
    {denied === tab && <p>Your role does not include this section.</p>}

    {tab === 'Stores' && denied !== tab && <section>{!d.overview ? <p className="muted">Loading…</p> : stores.length === 0 ? <p className="muted">No stores yet.</p> : <div className="card scroll"><table><thead><tr><th>Store</th><th>Status</th><th>Subscription</th><th></th></tr></thead><tbody>
      {stores.map((s: any) => <tr key={s.id}><td>{s.name}</td><td><Badge s={s.status} /></td><td>{s.subscription ?? s.subscription_status ?? '-'}</td><td><button className="secondary" onClick={async () => { try { setStore(await call(`/api/platform/tenants/${s.id}`)); } catch (e: any) { setErr(e.message); } }}>Review</button></td></tr>)}</tbody></table></div>}
      {store && <div className="card"><h2>{store.name} <Badge s={store.status} /></h2><p className="muted">{store.kind === 'direct' ? 'Direct store' : 'Vendor store'}{store.slug ? ` · /s/${store.slug}` : ''} · created {day(store.createdAt)} · subscription {store.subscription ?? 'none'} · {store.openJobs} jobs in progress · {store.openTickets} open tickets</p>
        <h3>Checklist</h3><ul>{store.checklist.map((c: any) => <li key={c.item}>{c.done ? '✓' : '○'} {c.item}{c.done ? '' : ' (not yet)'}</li>)}</ul>
        <p className="muted">People: {store.people.map((p: any) => `${p.count} ${words(p.role)}`).join(', ') || 'none'}. A store becomes active only when its subscription payment is confirmed by the payment provider; it cannot be activated by hand here.</p>
        {store.status === 'suspended' ? <><p role="alert" className="err">Suspended {when(store.suspendedAt)}: {store.suspendedReason}</p>
          <form onSubmit={form(f => call(`/api/platform/tenants/${store.id}`, 'POST', { action: 'reactivate', reason: f.get('reason') }), 'Store reactivated.')}><label htmlFor="rr">Reason for reactivating (owner only)</label><input id="rr" name="reason" minLength={10} required /><button disabled={busy}>Reactivate store</button></form></>
          : ['active', 'pending', 'closing'].includes(store.status) && <form onSubmit={form(f => call(`/api/platform/tenants/${store.id}`, 'POST', { action: 'suspend', reason: f.get('reason') }), 'Store suspended. Nobody in it can sign in to it until it is reactivated.')}><label htmlFor="sr">Reason for suspending</label><input id="sr" name="reason" minLength={10} required /><p className="muted">Suspension blocks the store's staff and customers at once. Files, balances and history are kept exactly as they are.</p><button className="danger" disabled={busy}>Suspend store</button></form>}</div>}</section>}

    {tab === 'People' && denied !== tab && <section className="card"><h2>Find a person</h2>
      <form className="inline" onSubmit={e => { e.preventDefault(); act(async () => { setPeople(await call(`/api/platform/people?q=${encodeURIComponent(q.trim())}`)); }, ''); }}><div><label htmlFor="pq">Part of the email address (at least 3 characters)</label><input id="pq" value={q} onChange={e => setQ(e.target.value)} minLength={3} required /></div><button disabled={busy}>Search</button></form>
      <p className="muted">Shows accounts and which stores they belong to. Artwork, files and balances are not shown here. Searches are recorded.</p>
      {people && (people.length === 0 ? <p className="muted">Nobody matches.</p> : people.map(p => <div className="card" key={p.id}><strong>{p.email}</strong> · <Badge s={p.closed ? 'closed' : p.status} />{p.verified ? '' : ' · email not verified'} · joined {day(p.createdAt)}
        <p className="muted">{p.memberships.length ? p.memberships.map((m: any) => `${words(m.role)} at ${m.store}`).join('; ') : 'No active memberships'}</p>
        {p.blockedReason && <p className="err">Blocked: {p.blockedReason}</p>}
        {!p.closed && <form onSubmit={form(f => call('/api/platform/people', 'POST', { userId: p.id, action: p.blockedReason ? 'unblock' : 'block', reason: f.get('reason') }), p.blockedReason ? 'Unblocked.' : 'Blocked and signed out everywhere.')}><div className="inline"><div style={{ flex: '3 1 260px' }}><label htmlFor={`pr${p.id}`}>Reason</label><input id={`pr${p.id}`} name="reason" minLength={10} required /></div><button className={p.blockedReason ? '' : 'danger'} disabled={busy}>{p.blockedReason ? 'Unblock (owner only)' : 'Block sign-in'}</button></div></form>}</div>))}</section>}

    {tab === 'Staff' && denied !== tab && <section>{!d.staff ? <p className="muted">Loading…</p> : <>
      <div className="card scroll"><table><thead><tr><th>Email</th><th>Role</th><th>Two-step sign-in</th><th>Since</th><th></th></tr></thead><tbody>
        {d.staff.staff.map((s: any) => <tr key={s.id}><td>{s.email}{s.me ? ' (you)' : ''}</td><td>{ROLE[s.role]}</td><td>{s.twoStep ? 'On' : 'Not set up'}</td><td>{day(s.since)}</td>
          <td>{!s.me && <form className="inline" onSubmit={form(f => call(`/api/platform/staff/${s.id}`, 'PATCH', (f.get('do') as string) === 'remove' ? { remove: true, code: f.get('code') } : { role: f.get('do'), code: f.get('code') }), 'Changed. They have been signed out and told by email.')}><div><label htmlFor={`sd${s.id}`}>Change</label><select id={`sd${s.id}`} name="do" defaultValue={s.role}>{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}<option value="remove">Remove access</option></select></div><CodeField id={`sc${s.id}`} /><button disabled={busy}>Apply</button></form>}</td></tr>)}</tbody></table></div>
      {d.staff.invites.length > 0 && <div className="card"><h3>Invitations waiting</h3><ul>{d.staff.invites.map((i: any) => <li key={i.id}>{i.email} as {ROLE[i.role]}, expires {day(i.expiresAt)} <button className="secondary" disabled={busy} onClick={() => act(() => call(`/api/platform/staff/${i.id}`, 'DELETE'), 'Invitation cancelled.')}>Cancel</button></li>)}</ul></div>}
      <form className="card" onSubmit={form(f => call('/api/platform/staff', 'POST', { email: f.get('email'), role: f.get('role'), code: f.get('code') }), 'Invitation sent. It works once and expires in 7 days.')}><h3>Invite platform staff</h3>
        <div className="inline"><div style={{ flex: '2 1 220px' }}><label htmlFor="se">Email (must not already have an account)</label><input id="se" name="email" type="email" required /></div><div><label htmlFor="sro">Role</label><select id="sro" name="role" defaultValue="platform_support">{Object.entries(ROLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div><CodeField id="sic" /><button disabled={busy}>Send invitation</button></div>
        <p className="muted">Owner: everything. Finance: payments, ledgers, refunds, payout accounts and settlements; no artwork. Support: enquiries, tickets, stores and people; no money movements. Nobody can change their own role, and the last owner cannot be removed.</p></form></>}</section>}

    {tab === 'Direct store' && denied !== tab && <section>{!d.direct ? <p className="muted">Loading…</p> : !d.direct.exists ? <div className="card"><p>No direct store yet. Create it from <a href="/admin">Administration</a>.</p></div> : <>
      <div className="card"><h2>{d.direct.name} <Badge s={d.direct.status} /></h2><p><a href={`/s/${d.direct.slug}`}>/s/{d.direct.slug}</a></p><div className="grid">
        <div className="stat"><strong>{d.direct.customers}</strong><span className="muted">Customers</span></div>
        <div className="stat"><strong>{Object.entries(d.direct.jobs30d).map(([k, v]) => `${v} ${words(k)}`).join(', ') || 'None'}</strong><span className="muted">Jobs in the last 30 days</span></div>
        <div className="stat"><strong>{d.direct.price ? `${rs(d.direct.price.perMpPaise)} per megapixel, minimum ${rs(d.direct.price.minPaise)}` : 'Not set'}</strong><span className="muted">Customer price{d.direct.price ? '' : ': customers cannot get a quote until it is set'}</span></div></div>
        {d.direct.canEdit && <form onSubmit={form(f => call('/api/platform/direct', 'POST', { perMpPaise: Math.round(Number(f.get('mp')) * 100), minPaise: Math.round(Number(f.get('min')) * 100) }), 'Price saved. Quotes already given keep their price.')}><div className="inline"><div><label htmlFor="dmp">Price per megapixel (₹)</label><input id="dmp" name="mp" type="number" min="0" step="0.01" required /></div><div><label htmlFor="dmin">Minimum charge (₹)</label><input id="dmin" name="min" type="number" min="0" step="0.01" required /></div><button disabled={busy}>Save price</button></div></form>}
        <p className="muted">The direct store is the owner's own channel: it has no store processing charge and nothing is owed to a vendor for its sales.</p></div>
      <div className="card"><h3>Refund requests waiting for the owner</h3>{d.direct.refundsWaiting.length === 0 ? <p className="muted">None.</p> : <ul>{d.direct.refundsWaiting.map((r: any) => <li key={r.id}>{r.reference} · {rs(r.amountPaise)} · {when(r.createdAt)}</li>)}</ul>}<p><a href="/admin/finance">Decide them in Finance, under Refunds</a></p></div>
      <div className="card"><h3>Open tickets</h3>{d.direct.openTickets.length === 0 ? <p className="muted">None.</p> : <ul>{d.direct.openTickets.map((t: any) => <li key={t.id}><a href="/support">{t.reference}</a> · {t.subject} · {words(t.status)}</li>)}</ul>}</div></>}</section>}

    {tab === 'Configuration' && denied !== tab && <section>{!d.config ? <p className="muted">Loading…</p> : <>
      <div className="card"><h2>What is switched on <span className="badge">{d.config.environment}</span></h2><dl>
        <dt>Payments</dt><dd>{d.config.payments.configured ? `${d.config.payments.name}${d.config.payments.testMode ? ' (TEST MODE)' : ''}` : `Not connected. ${d.config.payments.problem ?? ''}`}</dd>
        <dt>Settlement transfers</dt><dd>{d.config.payments.settlement}</dd>
        <dt>Email</dt><dd>{d.config.email.sending ? `Sending through ${d.config.email.driver} from ${d.config.email.from}` : 'NOT BEING SENT: no sender is configured'} · {d.config.email.waiting} waiting · {d.config.email.failed} failed</dd>
        <dt>File storage</dt><dd>{d.config.storage.driver}{d.config.storage.driver === 's3' ? (d.config.storage.bucket ? ' (bucket set)' : ' (bucket missing)') : ' (this server\'s disk; not for production)'}</dd>
        <dt>Two-step sign-in</dt><dd>{d.config.security.twoStepKey ? 'Encryption key set' : 'Encryption key missing'} · required for {d.config.security.twoStepRequiredRoles.map(words).join(', ') || 'nobody'}</dd>
        <dt>Download links</dt><dd>{d.config.security.downloadLinkSecret ? 'Signing secret set' : 'Signing secret missing'} · valid {d.config.limits.downloadLinkMinutes} minutes</dd></dl>
        <p className="muted">Passwords, keys and tokens are set in the hosting environment. They are never shown or edited here.</p>
        {d.config.canSendTest && <button className="secondary" disabled={busy} onClick={() => act(() => call('/api/platform/config', 'POST'), 'A test message was queued to your own address.')}>Send a test email to myself</button>}</div>
      <div className="card"><h3>Limits</h3><ul><li>Upload: JPG or PNG up to {d.config.limits.uploadMb} MB and {d.config.limits.uploadMegapixels} megapixels</li><li>Output: up to {d.config.limits.maxSideMm} mm per side and {d.config.limits.outputMegapixels} megapixels including bleed</li><li>A price is held for {d.config.limits.quoteMinutes} minutes; an unused hold is released after {d.config.limits.holdExpiryMinutes} minutes</li><li>Finished files are kept {d.config.limits.retentionDays} days</li><li>Customer top-up: ₹{d.config.limits.topUpMinRupees} to ₹{d.config.limits.topUpMaxRupees.toLocaleString('en-IN')}</li></ul>
        <h3>Scheduled work</h3><ul>{d.config.schedule.map((s: any) => <li key={s.task}>{words(s.task)}: every {s.every}</li>)}</ul><p className="muted">Last run and result of each task are on the <a href="/admin">Administration</a> page.</p></div></>}</section>}

    {tab === 'Incidents' && denied !== tab && <section>
      <form className="card" onSubmit={form(f => call('/api/platform/incidents', 'POST', { title: f.get('title'), severity: f.get('severity'), scope: f.get('scope') }), 'Incident recorded.')}><h2>Record an incident</h2>
        <div className="inline"><div style={{ flex: '3 1 260px' }}><label htmlFor="it">Title</label><input id="it" name="title" minLength={5} maxLength={160} required /></div><div><label htmlFor="is">Severity</label><select id="is" name="severity"><option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option></select></div></div>
        <label htmlFor="isc">What is affected</label><textarea id="isc" name="scope" minLength={10} required rows={2} /><button disabled={busy}>Record incident</button>
        <p className="muted">This is the record of what was done and who approved it. The restore itself follows the runbook (docs/BACKUP_RESTORE.md); nothing on this page restores or deletes data.</p></form>
      {!d.incidents ? <p className="muted">Loading…</p> : d.incidents.incidents.length === 0 ? <p className="muted">No incidents recorded.</p> : d.incidents.incidents.map((i: any) => <div className="card" key={i.id}>
        <strong>{i.reference}</strong> · {i.title} · <Badge s={i.severity === 'critical' ? 'failed' : 'pending'} /> {i.severity} · <Badge s={i.status} /> · recorded by {i.recorder} on {when(i.createdAt)}<p>{i.scope}</p>
        {i.backupRef && <p className="muted">Backup restored: {i.backupRef}</p>}{i.approver && <p className="muted">Reopening approved by {i.approver}. Evidence: {i.evidence}</p>}
        {i.notes.length > 0 && <ol>{i.notes.map((n: any, k: number) => <li key={k}>{words(n.status)} · {n.email} · {when(n.created_at)}: {n.note}</li>)}</ol>}
        {i.next.length > 0 && <form onSubmit={form(f => call(`/api/platform/incidents/${i.id}`, 'POST', { to: f.get('to'), note: f.get('note'), backupRef: f.get('backup'), evidence: f.get('evidence'), code: f.get('code') }), 'Step recorded.')}>
          <div className="inline"><div><label htmlFor={`in${i.id}`}>Next step</label><select id={`in${i.id}`} name="to">{i.next.map((n: string) => <option key={n} value={n}>{STEP[n]}</option>)}</select></div><div style={{ flex: '3 1 260px' }}><label htmlFor={`io${i.id}`}>What was done</label><input id={`io${i.id}`} name="note" minLength={10} required /></div></div>
          {i.next.includes('restored') && <><label htmlFor={`ib${i.id}`}>Backup restored (needed for "Record restore")</label><input id={`ib${i.id}`} name="backup" /></>}
          {i.next.includes('reopened') && <><label htmlFor={`ie${i.id}`}>Evidence for reopening: test results and reconciliation reference (owner only)</label><input id={`ie${i.id}`} name="evidence" /><CodeField id={`ic${i.id}`} /></>}
          <button disabled={busy}>Record step</button></form>}</div>)}</section>}
  </main>;
}
