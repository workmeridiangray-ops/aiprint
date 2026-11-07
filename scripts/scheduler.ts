// Runs scheduled work. Safe to rerun: lifecycle transitions and reminders are idempotent.
import { runSubscriptionLifecycle } from '../src/server/vendor';
let stop = false; process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });
while (!stop) {
  try { const r = await runSubscriptionLifecycle(); console.log(new Date().toISOString(), 'subscription lifecycle', JSON.stringify(r)); }
  catch (e: any) { console.error('scheduler error (route to operations)', e.message); }
  for (let i = 0; i < 3600 && !stop; i++) await new Promise(r => setTimeout(r, 1000));
}
