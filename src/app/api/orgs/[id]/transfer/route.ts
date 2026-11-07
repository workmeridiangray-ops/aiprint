import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import * as O from '@/server/org';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => { await O.transferAdmin(actor, params.id, String((await req.json()).memberId ?? '')); return { ok: true }; });
