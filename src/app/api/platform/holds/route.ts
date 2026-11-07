import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { placeHold, releaseHold } from '@/server/retention';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => { const b = await req.json(); await placeHold(actor, String(b.outputId ?? ''), String(b.reason ?? '')); return NextResponse.json({ ok: true }); });
export const DELETE = handler(async (req, { actor }) => { const b = await req.json(); await releaseHold(actor, String(b.outputId ?? '')); return NextResponse.json({ ok: true }); });
