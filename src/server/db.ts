import pg from 'pg';

let pool: pg.Pool | null = null;
export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not configured');
    pool = new pg.Pool({ connectionString: url, max: 10 });
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
