import { NextResponse } from 'next/server';
import { handler, COOKIE } from '@/server/http';
import { login } from '@/server/auth';
export const runtime = 'nodejs';
export const POST = handler(async req => {
  const { email, password } = await req.json();
  const { token } = await login(String(email ?? ''), String(password ?? ''));
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.APP_ENV === 'production', path: '/', maxAge: Number(process.env.SESSION_TTL_HOURS ?? 12) * 3600 });
  return res;
}, { public: true });
