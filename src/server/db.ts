import pg from 'pg';

/** Connection settings. Hosted Postgres (Supabase etc.) needs TLS: set DATABASE_SSL=require (verified against the system CA store, or DATABASE_SSL_CA with the provider's CA PEM).
 *  DATABASE_SSL=no-verify encrypts without checking the certificate: weaker, only as a last resort. Unset = whatever the URL says (local development). */
export function pgConfig(): pg.ClientConfig {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not configured');
  const mode = process.env.DATABASE_SSL;
  const clean = mode ? url.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, '') : url; // an explicit DATABASE_SSL wins over sslmode in the URL
  if (!mode) return { connectionString: url };
  if (mode === 'require') return { connectionString: clean, ssl: process.env.DATABASE_SSL_CA ? { ca: process.env.DATABASE_SSL_CA, rejectUnauthorized: true } : { rejectUnauthorized: true } };
  if (mode === 'no-verify') return { connectionString: clean, ssl: { rejectUnauthorized: false } };
  throw new Error('DATABASE_SSL must be "require" or "no-verify"');
}
let pool: pg.Pool | null = null;
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ ...pgConfig(), max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  }
  return pool;
}
export async function closePool() { if (pool) { await pool.end(); pool = null; } }

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await getPool().connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback');
    throw e;
  } finally { c.release(); }
}
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
