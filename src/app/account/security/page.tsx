'use client';
import { useEffect, useState } from 'react';
const j = { 'content-type': 'application/json' };
async function call(url: string, method: string, body?: unknown) {
  const r = await fetch(url, { method, headers: j, body: body ? JSON.stringify(body) : undefined });
  if (r.status === 401) { location.href = '/login'; throw new Error('auth'); }
  const b = await r.json().catch(() => ({})); if (!r.ok) throw new Error(b.message ?? 'Request failed'); return b;
}
export default function Security() {
  const [st, setSt] = useState<any>(null); const [setup, setSetup] = useState<any>(null); const [codes, setCodes] = useState<string[] | null>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  async function load() { try { setSt(await call('/api/auth/mfa/enrol', 'GET')); } catch (e: any) { if (e.message !== 'auth') setErr(e.message); } }
  useEffect(() => { load(); }, []);
  async function act(fn: () => Promise<void>) { setErr(''); setMsg(''); try { await fn(); } catch (e: any) { if (e.message !== 'auth') setErr(e.message); } }
  const code = (e: React.FormEvent<HTMLFormElement>) => { e.preventDefault(); return String(new FormData(e.currentTarget).get('code') ?? ''); };
  return <main><h1>Account security</h1><p role="status" className="muted">{msg}</p><p role="alert" className="err">{err}</p>
    {!st ? (!err && <p className="muted">Loading…</p>) : <>
      {st.required && !st.enabled && <div className="card"><strong>Two-step sign-in is required for your role.</strong> Set it up now to continue.</div>}
      <section className="card"><h2>Two-step sign-in</h2>
        {codes ? <><p><strong>Save these recovery codes now.</strong> Each works once if you lose your phone. They are shown only this time.</p>
          <pre data-testid="recovery-codes" style={{ fontSize: 16, lineHeight: 1.6 }}>{codes.join('\n')}</pre>
          <button onClick={() => { setCodes(null); load(); }}>I have saved them</button></>
        : st.enabled ? <>
          <p>On. {st.recoveryCodesLeft} recovery code{st.recoveryCodesLeft === 1 ? '' : 's'} left.</p>
          <form onSubmit={e => { const c = code(e); act(async () => { const r = await call('/api/auth/mfa/codes', 'POST', { code: c }); setCodes(r.recoveryCodes); }); }}>
            <label htmlFor="rc">Current code from your app (to make new recovery codes)</label><input id="rc" name="code" inputMode="numeric" required /><button>Make new recovery codes</button></form>
          {!st.required && <form onSubmit={e => { const c = code(e); act(async () => { await call('/api/auth/mfa/disable', 'POST', { code: c }); location.href = '/login'; }); }}>
            <label htmlFor="dc">Current code from your app (to turn off; this signs you out everywhere)</label><input id="dc" name="code" inputMode="numeric" required /><button>Turn off</button></form>}
        </> : setup ? <>
          <p>Scan this with an authenticator app, then enter the 6-digit code it shows.</p>
          <img src={setup.qr} alt="QR code for your authenticator app" width={220} height={220} />
          <p className="muted">Can't scan? Enter this key by hand: <code data-testid="secret">{setup.secret}</code></p>
          <form onSubmit={e => { const c = code(e); act(async () => { const r = await call('/api/auth/mfa/enrol', 'PUT', { code: c }); setSetup(null); setCodes(r.recoveryCodes); }); }}>
            <label htmlFor="cc">6-digit code</label><input id="cc" name="code" inputMode="numeric" autoComplete="one-time-code" required /><button>Turn on</button></form>
        </> : <><p>Off. Adds a code from your phone to every sign-in.</p><button onClick={() => act(async () => setSetup(await call('/api/auth/mfa/enrol', 'POST')))}>Set up</button></>}
      </section>
      <p><a href="/projects">Back</a></p></>}
  </main>;
}
