'use client';
import { useEffect, useState } from 'react';
const j = { 'content-type': 'application/json' };
export default function MyData() {
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [exp, setExp] = useState<{ id: string; expiresAt: string } | null>(null);
  const [cl, setCl] = useState<any>(null); const [needCode, setNeedCode] = useState(false);
  async function loadCl() { const r = await fetch('/api/account/closure'); if (r.status === 401) { location.href = '/login'; return; } if (r.ok) setCl(await r.json()); }
  useEffect(() => { loadCl(); fetch('/api/auth/mfa/enrol').then(r => r.ok ? r.json() : null).then(s => s && setNeedCode(!!s.enabled)); }, []);
  async function makeExport() { setErr(''); const r = await fetch('/api/account/export', { method: 'POST' }); const b = await r.json(); if (r.ok) setExp(b); else setErr(b.message); }
  async function startClose(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); setErr(''); const r = await fetch('/api/account/closure', { method: 'POST', headers: j, body: JSON.stringify({ reason: new FormData(e.currentTarget).get('reason') }) }); const b = await r.json(); if (r.ok) setCl(b); else setErr(b.message); }
  async function confirm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setErr(''); const f = new FormData(e.currentTarget);
    const r = await fetch('/api/account/closure', { method: 'PUT', headers: j, body: JSON.stringify({ id: cl.id, password: f.get('password'), code: f.get('code') || undefined }) }); const b = await r.json();
    if (!r.ok) { setErr(b.message); return; } if (b.status === 'closed') { location.href = '/login'; return; } setCl({ ...cl, ...b });
  }
  const blocked = cl?.status === 'blocked'; const awaiting = cl?.status === 'awaiting_confirmation';
  return <main><h1>My data</h1><p role="status" className="muted">{msg}</p><p role="alert" className="err">{err}</p>
    <section className="card"><h2>Download my data</h2><p className="muted">A file listing your account records: projects, quotes, charges, files and support tickets. Your artwork files are not inside it: download them from <a href="/library">Your files</a> while they are kept. The download link works for 7 days.</p>
      <button onClick={makeExport}>Prepare my data</button>{exp && <p>Ready. <a href={`/api/account/export?id=${exp.id}`}>Download (JSON)</a> <span className="muted">· available until {new Date(exp.expiresAt).toLocaleDateString()}</span></p>}</section>
    <section className="card"><h2>Close my account</h2>
      <p>Closing stops all access at once. Your files are deleted within 7 days. Records of payments, support tickets and the audit trail are kept separately from your files. Copies you downloaded earlier cannot be removed from your devices or anyone you shared them with.</p>
      {blocked && <div><p><strong>Your account cannot be closed yet:</strong></p><ul data-testid="liabilities">{cl.liabilities.map((l: any) => <li key={l.code}>{l.message}</li>)}</ul><p className="muted">Fix these, then ask again.</p></div>}
      {awaiting ? <form onSubmit={confirm}><p><strong>Last step.</strong> Enter your password{needCode ? ' and the code from your authenticator app' : ''} to close the account. This cannot be undone.</p>
        <label htmlFor="pw">Password</label><input id="pw" name="password" type="password" autoComplete="current-password" required />
        {needCode && <><label htmlFor="cd">Code</label><input id="cd" name="code" inputMode="numeric" required /></>}
        <button>Close my account for good</button></form>
      : <form onSubmit={startClose}><label htmlFor="rs">Why are you leaving? (optional)</label><input id="rs" name="reason" maxLength={500} /><button>{blocked ? 'Check again' : 'Start closing my account'}</button></form>}
    </section><p><a href="/support">Need help instead?</a> · <a href="/projects">Back</a></p></main>;
}
