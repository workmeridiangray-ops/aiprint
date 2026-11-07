import { NextResponse } from 'next/server';
import { getPool } from '@/server/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Liveness and database check for the host's health probe. Public and deliberately minimal: no versions, settings or counts. */
export async function GET() {
  try { await getPool().query('select 1'); return NextResponse.json({ ok: true }); }
  catch { return NextResponse.json({ ok: false }, { status: 503 }); }
}
