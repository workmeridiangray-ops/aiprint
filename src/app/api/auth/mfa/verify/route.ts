import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { verifyChallenge } from '@/server/mfa';
import { withSession, clientSource } from '@/server/cookie';
export const runtime = 'nodejs';
export const POST = handler(async req => {
  const b = await req.json(); const r = await verifyChallenge(String(b.challenge ?? ''), String(b.code ?? ''), clientSource(req));
  return withSession(NextResponse.json({ ok: true, usedRecovery: r.usedRecovery }), r.token);
}, { public: true });
