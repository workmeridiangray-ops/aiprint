import IORedis from 'ioredis';

/** Redis carries wake-up signals only. The jobs, leases and money live in Postgres, so losing Redis (or its data) never loses or double-runs a
 *  job: a missed signal only delays pickup until the worker's next poll, and a stale or duplicate signal finds nothing to claim. */
const LIST = 'artwork:jobs';
let conn: IORedis | null = null; let connUrl: string | undefined; let blocking: IORedis | null = null;
export const queueConfigured = () => !!process.env.REDIS_URL;
function make(blockingConn = false) {
  const c = new IORedis(process.env.REDIS_URL!, { lazyConnect: true, maxRetriesPerRequest: blockingConn ? null : 1, enableOfflineQueue: blockingConn, connectTimeout: 1500, retryStrategy: t => Math.min(t * 200, 3000) });
  c.on('error', () => { /* surfaced through queueHealth and the worker's fallback polling, never thrown into a request */ });
  return c;
}
function client() { if (conn && connUrl !== process.env.REDIS_URL) { conn.disconnect(); conn = null; } connUrl = process.env.REDIS_URL; return (conn ??= make()); }
const within = <T>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

/** Best-effort, bounded, called after the database commit. Never throws and never holds up a customer request. */
export async function notifyJob(jobId: string): Promise<boolean> {
  if (!queueConfigured()) return false;
  try { const c = client(); if (c.status === 'wait') await within(c.connect(), 1500); await within(c.lpush(LIST, jobId), 500); return true; }
  catch { return false; }
}
/** Waits for a signal. Returns true when one arrived, false on timeout or when Redis is unreachable (the caller then just polls). */
export async function waitForJob(timeoutSeconds: number): Promise<boolean> {
  if (!queueConfigured()) { await new Promise(r => setTimeout(r, timeoutSeconds * 1000)); return false; }
  try {
    blocking ??= make(true); const r = await within(blocking.brpop(LIST, timeoutSeconds), (timeoutSeconds + 2) * 1000); // bounded: a dead connection must not hang the worker
    return !!r;
  } catch { blocking?.disconnect(); blocking = null; await new Promise(r => setTimeout(r, 1000)); return false; }
}
export async function queueHealth() {
  if (!queueConfigured()) return { configured: false as const };
  try { const c = client(); if (c.status === 'wait') await within(c.connect(), 1500); await within(c.ping(), 800); return { configured: true as const, reachable: true as const, signals: await within(c.llen(LIST), 800) }; }
  catch { return { configured: true as const, reachable: false as const, signals: null }; }
}
export async function closeQueue() { conn?.disconnect(); blocking?.disconnect(); conn = null; blocking = null; }
