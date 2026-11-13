// Runs scheduled work. Safe to rerun: lifecycle transitions and reminders are idempotent.
import { runSubscriptionLifecycle } from '../src/server/vendor';
import { runRetention, recordRun } from '../src/server/retention';
import { runAccountMaintenance } from '../src/server/account';
import { expireUndispatchedHolds } from '../src/server/quotes';
import { purgeClosedStores } from '../src/server/storeadmin';
import { reconcilePayments } from '../src/server/payments';
import { reconcileRefunds } from '../src/server/refunds';
import { reconcileTransfers } from '../src/server/settlements';
let stop = false; process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });
while (!stop) {
  const tasks: Array<[string, () => Promise<unknown>]> = [['hold_expiry', () => expireUndispatchedHolds()], ['subscription_lifecycle', () => runSubscriptionLifecycle()], ['retention', () => runRetention()], ['account_maintenance', () => runAccountMaintenance()], ['closed_store_purge', () => purgeClosedStores()], ['payment_reconcile', () => reconcilePayments()], ['refund_reconcile', () => reconcileRefunds()], ['transfer_reconcile', () => reconcileTransfers()]];
  for (const [task, fn] of tasks) {
    try { const r = await recordRun(task, fn); console.log(new Date().toISOString(), task, JSON.stringify(r)); }
    catch (e: any) { console.error('scheduler task failed (route to operations):', task, e.message); }
  }
  for (let i = 0; i < 3600 && !stop; i++) {
    if (i % 300 === 299) { try { const r = await recordRun('hold_expiry', () => expireUndispatchedHolds()); if (r.released) console.log(new Date().toISOString(), 'hold_expiry', JSON.stringify(r)); await recordRun('payment_reconcile', () => reconcilePayments()); } catch (e: any) { console.error('scheduler task failed (route to operations): hold_expiry', e.message); } }
    await new Promise(r => setTimeout(r, 1000));
  }
}
