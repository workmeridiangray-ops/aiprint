import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { login } from '@/server/auth';
import { withSession, clientSource } from '@/server/cookie';
export const runtime = 'nodejs';
export const POST = handler(async req => {
  const { email, password } = await req.json();
  const r = await login(String(email ?? ''), String(password ?? ''), clientSource(req));
  if (r.challenge) return NextResponse.json({ mfaRequired: true, challenge: r.challenge });
  return withSession(NextResponse.json({ ok: true, enrolOnly: !!r.enrolOnly }), r.token!);
}, { public: true });
