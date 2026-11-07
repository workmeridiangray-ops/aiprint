// Runs scheduled work. Safe to rerun: lifecycle transitions and reminders are idempotent.
import { runSubscriptionLifecycle } from '../src/server/vendor';
import { runRetention, recordRun } from '../src/server/retention';
let stop = false; process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });
while (!stop) {
  const tasks: Array<[string, () => Promise<unknown>]> = [['subscription_lifecycle', () => runSubscriptionLifecycle()], ['retention', () => runRetention()]];
  for (const [task, fn] of tasks) {
    try { const r = await recordRun(task, fn); console.log(new Date().toISOString(), task, JSON.stringify(r)); }
    catch (e: any) { console.error('scheduler task failed (route to operations):', task, e.message); }
  }
  for (let i = 0; i < 3600 && !stop; i++) await new Promise(r => setTimeout(r, 1000));
}
