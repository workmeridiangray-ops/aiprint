import { NextRequest, NextResponse } from 'next/server';
import { AppError } from './db';
import { resolveActor, type Actor } from './auth';
import { randomUUID } from 'node:crypto';

export const COOKIE = 'aw_session';

function sameOrigin(req: NextRequest) {
  if (['GET', 'HEAD'].includes(req.method)) return true;
  const o = req.headers.get('origin');
  return !!o && o === req.nextUrl.origin; // CSRF: mutating calls must come from our own origin
}

export function handler(fn: (req: NextRequest, ctx: { actor: Actor; params: Record<string, string> }) => Promise<unknown>, opts: { public?: boolean; allowEnrolOnly?: boolean; webhook?: boolean } = {}) {
  return async (req: NextRequest, { params }: { params: Promise<Record<string, string>> }) => {
    const cid = randomUUID();
    try {
      if (!opts.webhook && !sameOrigin(req)) throw new AppError('bad_origin', 'Request origin not allowed', 403);
      const p = await params;
      const actor = opts.public ? (null as unknown as Actor) : await resolveActor(req.cookies.get(COOKIE)?.value, req.headers.get('x-tenant-id') ?? undefined, { allowEnrolOnly: opts.allowEnrolOnly });
      const out = await fn(req, { actor, params: p });
      return out instanceof NextResponse ? out : NextResponse.json(out, { headers: { 'x-correlation-id': cid } });
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: e.code, message: e.message, ...((e as any).current ? { current: (e as any).current } : {}) }, { status: e.status, headers: { 'x-correlation-id': cid } });
      console.error('unhandled', cid, e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'server_error', message: 'Something went wrong. Quote this reference to support: ' + cid }, { status: 500, headers: { 'x-correlation-id': cid } });
    }
  };
}
