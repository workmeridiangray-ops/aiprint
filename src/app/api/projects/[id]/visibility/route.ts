import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import * as O from '@/server/org';
export const runtime = 'nodejs';
export const PATCH = handler(async (req, { actor, params }) => { await O.setVisibility(actor, params.id, (await req.json()).visibility); return { ok: true }; });
