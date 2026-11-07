import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { requestClosure, confirmClosure, closureStatus } from '@/server/account';
import { COOKIE } from '@/server/http';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => NextResponse.json((await closureStatus(actor)) ?? { status: 'none' }));
export const POST = handler(async (req, { actor }) => requestClosure(actor, String((await req.json().catch(() => ({}))).reason ?? '')));
export const PUT = handler(async (req, { actor }) => {
  const b = await req.json(); const r = await confirmClosure(actor, String(b.id ?? ''), String(b.password ?? ''), b.code ? String(b.code) : undefined);
  const res = NextResponse.json(r); if (r.status === 'closed') res.cookies.delete(COOKIE); return res;
});
