// Delivers queued email. Run alongside the worker and scheduler. Safe to run more than one copy.
import { deliverPending } from '../src/server/mailer';
import { recordRun } from '../src/server/retention';
let stop = false; process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });
let lastWarn = 0;
while (!stop) {
  try {
    const r = await deliverPending();
    if (r.blocked) { if (Date.now() - lastWarn > 60000) { console.error('email NOT being sent (route to operations):', r.blocked); lastWarn = Date.now(); } }
    else if (r.sent || r.retried || r.failed) { console.log(new Date().toISOString(), 'email', JSON.stringify(r)); await recordRun('email', async () => r).catch(() => {}); }
  } catch (e: any) { console.error('mailer error (route to operations):', e.message); }
  for (let i = 0; i < 10 && !stop; i++) await new Promise(r => setTimeout(r, 1000));
}
