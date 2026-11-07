import { describe, it, expect, afterEach } from 'vitest';
import { pgConfig } from '../src/server/db';
const keep = { u: process.env.DATABASE_URL, s: process.env.DATABASE_SSL, c: process.env.DATABASE_SSL_CA };
afterEach(() => { process.env.DATABASE_URL = keep.u; keep.s === undefined ? delete process.env.DATABASE_SSL : (process.env.DATABASE_SSL = keep.s); keep.c === undefined ? delete process.env.DATABASE_SSL_CA : (process.env.DATABASE_SSL_CA = keep.c); });
describe('database connection settings', () => {
  it('leaves local development untouched', () => { process.env.DATABASE_URL = 'postgres://a:b@localhost/x'; delete process.env.DATABASE_SSL; expect(pgConfig()).toEqual({ connectionString: 'postgres://a:b@localhost/x' }); });
  it('require verifies the certificate and drops sslmode from the URL', () => {
    process.env.DATABASE_URL = 'postgres://a:b@db.example.com:5432/x?sslmode=require&application_name=app'; process.env.DATABASE_SSL = 'require';
    const c = pgConfig(); expect(c.ssl).toEqual({ rejectUnauthorized: true }); expect(c.connectionString).toBe('postgres://a:b@db.example.com:5432/x?application_name=app');
  });
  it('accepts a provider CA, supports no-verify as an explicit weaker choice, and rejects unknown values', () => {
    process.env.DATABASE_URL = 'postgres://a:b@h/x'; process.env.DATABASE_SSL = 'require'; process.env.DATABASE_SSL_CA = 'PEM';
    expect(pgConfig().ssl).toEqual({ ca: 'PEM', rejectUnauthorized: true });
    process.env.DATABASE_SSL = 'no-verify'; expect(pgConfig().ssl).toEqual({ rejectUnauthorized: false });
    process.env.DATABASE_SSL = 'off'; expect(() => pgConfig()).toThrow(/require/);
  });
});

describe('create-owner script', () => {
  it('refuses weak input, creates one owner, then refuses a second', async () => {
    const { execFileSync } = await import('node:child_process'); const { setupDb, closePool, TEST_URL } = await import('./helpers'); const { getPool } = await import('../src/server/db');
    await setupDb();
    const run = (env: Record<string, string>) => execFileSync('npx', ['tsx', 'scripts/create-owner.ts'], { env: { ...process.env, DATABASE_URL: TEST_URL, APP_ENV: 'test', ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    expect(() => run({ OWNER_EMAIL: 'bad', OWNER_PASSWORD: 'long-enough-password' })).toThrow(/valid email/);
    expect(() => run({ OWNER_EMAIL: 'o@x.test', OWNER_PASSWORD: 'short' })).toThrow(/12 characters/);
    expect(run({ OWNER_EMAIL: 'o@x.test', OWNER_PASSWORD: 'long-enough-password' })).toMatch(/owner created/);
    expect((await getPool().query("select count(*)::int n from memberships where role='platform_owner'")).rows[0].n).toBe(1);
    expect((await getPool().query("select count(*)::int n from audit_log where action='platform.owner_created'")).rows[0].n).toBe(1);
    expect(() => run({ OWNER_EMAIL: 'o2@x.test', OWNER_PASSWORD: 'long-enough-password' })).toThrow(/already exists/);
    await closePool();
  });
});
