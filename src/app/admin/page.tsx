'use client';
import { useEffect, useState } from 'react';
const j = { 'content-type': 'application/json' };
const rs = (p: number) => `₹${(p / 100).toFixed(2)}`;
async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: j, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
  const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.message ?? 'Request failed'); return b;
}
const POLICY_NAMES: Record<string, string> = { terms: 'Terms', privacy: 'Privacy', refund: 'Refund policy', acceptable_use: 'Acceptable use' };
export default function Admin() {
  const [jobs, setJobs] = useState<any>(null); const [ov, setOv] = useState<any>(null); const [enq, setEnq] = useState<any[]>([]); const [runs, setRuns] = useState<any>(null); const [filter, setFilter] = useState('');
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [closing, setClosing] = useState<string | null>(null);
  async function load() {
    try {
      const [o, e, r] = await Promise.all([call('/api/platform/overview', 'GET'), call('/api/platform/enquiries' + (filter ? `?status=${filter}` : ''), 'GET'), call('/api/platform/runs', 'GET').catch(() => null)]);
      setOv(o); setEnq(e); setRuns(r); setJobs(await call('/api/platform/jobs', 'GET').catch(() => null));
    } catch (e: any) { if (e.message === 'Not permitted') setErr('This area is for platform staff.'); else if (e.message !== 'auth') setErr(e.message); }
  }
  useEffect(() => { load(); }, [filter]);
  async function act(fn: () => Promise<unknown>, ok: string) { setMsg(''); setErr(''); try { await fn(); setMsg(ok); await load(); } catch (e: any) { if (e.message !== 'auth') setErr(e.message); } }
  const form = (fn: (f: FormData) => Promise<unknown>, ok: string) => (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); const f = new FormData(e.currentTarget); act(() => fn(f), ok); };
  const owner = ov?.canEditSettings;
  return <main><h1>Platform administration</h1><p><a href="/account/security">Account security</a></p><p role="status" className="muted">{msg}</p><p role="alert" className="err">{err}</p>
    {!ov && !err && <p className="muted">Loading…</p>}
    {ov && <>
      <section className="card"><h2>Enquiries</h2>
        <div className="bar"><label htmlFor="flt">Show</label><select id="flt" value={filter} onChange={e => setFilter(e.target.value)}><option value="">All</option><option value="new">New</option><option value="in_progress">In progress</option><option value="closed">Closed</option></select>
          <span className="muted">{Object.entries(ov.enquiryCounts).map(([k, v]) => `${k.replace('_', ' ')} ${v}`).join(' · ') || 'None yet'}</span></div>
        {enq.length === 0 ? <p className="muted">No enquiries match.</p> : enq.map(e => <div className="card" key={e.id}>
          <strong>{e.subject}</strong> <span className="muted">{e.reference} · {e.name} &lt;{e.email}&gt; · {e.status.replace('_', ' ')} · {new Date(e.created_at).toLocaleString()}</span>
          <p style={{ whiteSpace: 'pre-wrap' }}>{e.message}</p>
          {e.resolution && <p className="muted">Resolution: {e.resolution}</p>}
          {e.status !== 'closed' && (closing === e.id
            ? <form onSubmit={form(async f => { await call(`/api/platform/enquiries/${e.id}`, 'PATCH', { status: 'closed', resolution: f.get('res') }); setClosing(null); }, 'Enquiry closed.')}><label htmlFor={`r${e.id}`}>How was this resolved?</label><input id={`r${e.id}`} name="res" required minLength={3} /> <button>Close enquiry</button> <button type="button" onClick={() => setClosing(null)}>Cancel</button></form>
            : <div className="bar">{e.status === 'new' && <button onClick={() => act(() => call(`/api/platform/enquiries/${e.id}`, 'PATCH', { status: 'in_progress' }), 'Marked in progress.')}>Take it</button>}<button onClick={() => setClosing(e.id)}>Close…</button></div>)}
          {e.status === 'closed' && <button onClick={() => act(() => call(`/api/platform/enquiries/${e.id}`, 'PATCH', { status: 'in_progress' }), 'Reopened.')}>Reopen</button>}</div>)}</section>

      <section className="card"><h2>Stores and subscriptions</h2>
        {ov.tenants.length === 0 ? <p className="muted">No stores yet.</p> : <table><thead><tr><th>Name</th><th>Type</th><th>Status</th><th>Subscription</th><th>Plan</th><th>Jobs</th><th>Storage used</th><th>Created</th></tr></thead><tbody>
          {ov.tenants.map((t: any) => <tr key={t.id}><td>{t.name}{t.slug ? <span className="muted"> /{t.slug}</span> : ''}</td><td>{t.kind}</td><td>{t.status}</td><td>{t.subscription ?? '-'}</td><td>{t.plan ?? '-'}</td><td>{t.jobs}</td><td className={t.storageQuotaBytes && t.storageUsedBytes >= t.storageQuotaBytes ? 'err' : ''}>{(t.storageUsedBytes / 1048576).toFixed(1)} MB{t.storageQuotaBytes ? ` of ${Math.round(t.storageQuotaBytes / 1048576)} MB${t.storageUsedBytes >= t.storageQuotaBytes ? ' (full)' : ''}` : ''}</td><td>{new Date(t.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table>}
        <p className="muted">A store becomes active only when a verified payment activates its subscription. Nothing here can mark one paid.</p></section>

      <section className="card"><h2>Processing price</h2>
        <p className="muted">{ov.processingPrice ? `Current: ${rs(ov.processingPrice.perMpPaise)} per megapixel, minimum ${rs(ov.processingPrice.minPaise)}. New quotes use this; earlier quotes keep their snapshot.` : 'Not set. Quotes cannot be priced until it is set.'}</p>
        {owner ? <form onSubmit={form(f => call('/api/platform/pricing', 'POST', { perMpPaise: Math.round(Number(f.get('pm')) * 100), minPaise: Math.round(Number(f.get('mn')) * 100) }), 'Processing price saved.')}>
          <div className="grid"><div><label htmlFor="pm">Per megapixel (₹)</label><input id="pm" name="pm" type="number" step="0.01" min="0" required /></div><div><label htmlFor="mn">Minimum per job (₹)</label><input id="mn" name="mn" type="number" step="0.01" min="0" required /></div></div><button>Save price</button></form> : <p className="muted">Only the platform owner can change this.</p>}</section>

      <section className="card"><h2>Plans</h2>
        {ov.plans.length === 0 ? <p className="muted">No plans yet.</p> : <table><thead><tr><th>Code</th><th>Name</th><th>Staff seats</th><th>Storage</th><th>Monthly</th><th>Version</th></tr></thead><tbody>{ov.plans.map((p: any) => <tr key={p.code}><td>{p.code}</td><td>{p.name}</td><td>{p.staffSeats}</td><td>{p.storageMb ? `${p.storageMb} MB` : 'Unlimited'}</td><td>{rs(p.monthlyPricePaise)}</td><td>{p.version}</td></tr>)}</tbody></table>}
        {owner && <form onSubmit={form(f => call('/api/platform/plans', 'POST', { code: f.get('code'), name: f.get('name'), staffSeats: Number(f.get('seats')), monthlyPricePaise: Math.round(Number(f.get('price')) * 100), storageMb: f.get('storage') }), 'Plan saved as a new version. Existing subscribers keep the version they bought.')}>
          <div className="grid"><div><label htmlFor="pc">Code</label><input id="pc" name="code" required /></div><div><label htmlFor="pn">Name</label><input id="pn" name="name" required /></div><div><label htmlFor="ps">Staff seats</label><input id="ps" name="seats" type="number" min="1" required /></div><div><label htmlFor="pp">Monthly price (₹)</label><input id="pp" name="price" type="number" step="0.01" min="0" required /></div><div><label htmlFor="pst">Storage (MB, empty = unlimited)</label><input id="pst" name="storage" type="number" min="1" step="1" /></div></div><button>Save plan</button></form>}</section>

      <section className="card"><h2>Policies</h2>
        <table><thead><tr><th>Policy</th><th>Status</th><th>Effective</th><th>Approved by</th></tr></thead><tbody>{ov.policies.map((p: any) => <tr key={p.slug}><td>{POLICY_NAMES[p.slug]}</td><td>{p.published ? `Published v${p.version}` : 'Not published'}</td><td>{p.effectiveDate ?? '-'}</td><td>{p.approvedBy ?? '-'}</td></tr>)}</tbody></table>
        {owner ? <form onSubmit={form(f => call('/api/platform/policies', 'POST', { slug: f.get('slug'), effectiveDate: f.get('date'), body: f.get('body'), approvedByName: f.get('who') }), 'Policy published as a new version.')}>
          <p className="muted">Paste only text approved by the client. Published versions cannot be edited; publish a new version instead.</p>
          <div className="grid"><div><label htmlFor="ps2">Policy</label><select id="ps2" name="slug">{Object.entries(POLICY_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div><div><label htmlFor="pd">Effective date</label><input id="pd" name="date" type="date" required /></div><div><label htmlFor="pw">Approved by (name)</label><input id="pw" name="who" required /></div></div>
          <label htmlFor="pb">Approved text</label><textarea id="pb" name="body" rows={8} required style={{ width: '100%' }} /><button>Publish</button></form> : <p className="muted">Only the platform owner can publish policies.</p>}</section>

      <section className="card"><h2>Direct store</h2>
        {ov.directStore ? <p>{ov.directStore.name}: <a href={`/store/${ov.directStore.slug}`}>/store/{ov.directStore.slug}</a></p> : owner ? <form onSubmit={form(f => call('/api/platform/direct-store', 'POST', { name: f.get('name'), slug: f.get('slug') }), 'Direct store created. Set its prices from the store dashboard before customers can get quotes.')}>
          <div className="grid"><div><label htmlFor="dn">Store name</label><input id="dn" name="name" required /></div><div><label htmlFor="ds">Web address</label><input id="ds" name="slug" required pattern="[a-z0-9][a-z0-9\-]{1,38}[a-z0-9]" /></div></div><button>Create direct store</button></form> : <p className="muted">No direct store yet.</p>}</section>

      <section className="card"><h2>Jobs needing attention</h2>
        {!jobs ? <p className="muted">Job list unavailable.</p> : <>
          <p className={jobs.stuck.length ? 'err' : 'muted'}>Running with an expired lease (will be requeued by the worker's reaper): {jobs.stuck.length}. Failed in the last 14 days: {jobs.failed.length}. Cancelled for not starting in time (all time): {jobs.holdsExpired}.</p>
          {jobs.waiting.length > 0 && <p className="muted">Oldest waiting: {Math.round(jobs.waiting[0].age_seconds / 60)} min ({jobs.waiting[0].tenant}).</p>}
          {jobs.failed.length > 0 && <table><thead><tr><th>Job</th><th>Store</th><th>Attempts</th><th>Last error</th><th>Finished</th></tr></thead><tbody>{jobs.failed.map((f: any) => <tr key={f.id}><td>{f.id.slice(0, 8)}</td><td>{f.tenant}</td><td>{f.attempts}</td><td>{f.last_error}</td><td>{new Date(f.finished_at).toLocaleString()}</td></tr>)}</tbody></table>}
          <p className="muted">Failed jobs released their funds; customers were not charged and can request a new price. No artwork or customer details are shown here.</p></>}</section>

      <section className="card"><h2>Scheduled work</h2>
        {!runs || runs.runs.length === 0 ? <p className="muted">The scheduler has not recorded a run yet. If it should be running, check it.</p> : <table><thead><tr><th>Task</th><th>Last run</th><th>Result</th></tr></thead><tbody>{runs.runs.map((r: any) => <tr key={r.task}><td>{r.task.replace('_', ' ')}</td><td>{new Date(r.started_at).toLocaleString()}</td><td className={r.ok === false ? 'err' : ''}>{r.ok === null ? 'running or interrupted' : r.ok ? JSON.stringify(r.summary) : `Failed: ${r.error}`}</td></tr>)}</tbody></table>}
        {runs?.email && <p className={!runs.email.configured || runs.email.failed > 0 ? 'err' : 'muted'}>Email: {runs.email.configured ? `${runs.email.pending} waiting${runs.email.pending ? ` (oldest ${runs.email.oldestPendingMinutes} min)` : ''}, ${runs.email.failed} failed` : `NOT BEING SENT. ${runs.email.blockedReason}. ${runs.email.pending} message(s) are waiting.`}</p>}
        {runs?.system && <><p className={runs.system.jobs.oldestQueuedMinutes > 5 ? 'err' : 'muted'}>Jobs: {runs.system.jobs.queued} waiting{runs.system.jobs.queued ? ` (oldest ${runs.system.jobs.oldestQueuedMinutes} min)` : ''}, {runs.system.jobs.running} running. {runs.system.jobs.oldestQueuedMinutes > 5 ? 'Check that a worker is running.' : ''}</p>
          <p className={runs.system.storage.configured ? 'muted' : 'err'}>File storage: {runs.system.storage.configured ? (runs.system.storage.driver === 'local' ? 'local disk (development only)' : 'object storage') : `NOT CONFIGURED. ${runs.system.storage.problem}`}</p>
          <p className="muted">Job wake-ups: {!runs.system.redis.configured ? 'Redis not set; workers check every 5 seconds' : runs.system.redis.reachable ? 'Redis connected' : 'Redis unreachable; workers fall back to checking every 5 seconds, no jobs are lost'}</p></>}
        {runs?.outputsFailingPurge > 0 && <p className="err">{runs.outputsFailingPurge} file(s) failed to purge and will be retried.</p>}</section></>}
  </main>;
}
