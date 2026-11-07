import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import * as O from '@/server/org';
export const runtime = 'nodejs';
export const PATCH = handler(async (req, { actor, params }) => { const b = await req.json(); await O.setMemberLimit(actor, params.id, params.mid, b.monthlyLimitPaise === null ? null : Number(b.monthlyLimitPaise)); return { ok: true }; });
export const DELETE = handler(async (_r, { actor, params }) => { await O.revokeMember(actor, params.id, params.mid); return { ok: true }; });
