import sharp from 'sharp';
if (process.env.LOW_MEMORY === '1') { sharp.cache(false); sharp.concurrency(1); } // small hosts (512 MB): no image cache, one thread
import { workOnce, reapExpired } from '../src/server/worker';
import { randomUUID } from 'node:crypto';
import { waitForJob, queueConfigured } from '../src/server/queue';
const id = `worker-${randomUUID().slice(0, 8)}`; console.log('worker started', id, queueConfigured() ? '(Redis wake-ups on, polling as backup)' : '(polling every 5 s; set REDIS_URL for instant pickup)');
let stop = false; process.on('SIGTERM', () => { stop = true; }); process.on('SIGINT', () => { stop = true; });
let lastReap = 0;
while (!stop) {
  if (Date.now() - lastReap > 15000) { const r = await reapExpired(); if (r.requeued || r.failed) console.log('reaped', r); lastReap = Date.now(); }
  const did = await workOnce(id).catch(e => { console.error('worker error', e.message); return false; });
  if (!did) await waitForJob(5); // wakes at once on a Redis signal; otherwise re-checks the database every 5 s, so a lost signal only delays
}
