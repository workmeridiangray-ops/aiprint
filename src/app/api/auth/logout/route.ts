import { NextResponse } from 'next/server';
import { handler, COOKIE } from '@/server/http';
import { logout } from '@/server/auth';
export const runtime = 'nodejs';
export const POST = handler(async req => {
  const t = req.cookies.get(COOKIE)?.value; if (t) await logout(t);
  const res = NextResponse.json({ ok: true }); res.cookies.delete(COOKIE); return res;
}, { public: true });
