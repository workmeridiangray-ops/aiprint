import { workOnce, reapExpired } from '../src/server/worker';
import { randomUUID } from 'node:crypto';
const id = `worker-${randomUUID().slice(0, 8)}`; console.log('worker started', id);
let stop = false; process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });
let lastReap = 0;
while (!stop) {
  if (Date.now() - lastReap > 15000) { const r = await reapExpired(); if (r.requeued || r.failed) console.log('reaped', r); lastReap = Date.now(); }
  const did = await workOnce(id).catch(e => { console.error('worker error', e.message); return false; });
  if (!did) await new Promise(r => setTimeout(r, 1000));
}
