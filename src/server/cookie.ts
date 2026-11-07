import { NextResponse } from 'next/server';
import { COOKIE } from './http';
export function withSession(res: NextResponse, token: string) {
  res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.APP_ENV === 'production', path: '/', maxAge: Number(process.env.SESSION_TTL_HOURS ?? 12) * 3600 });
  return res;
}
export const clientSource = (req: Request) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'; // deploy behind a proxy that sets this
