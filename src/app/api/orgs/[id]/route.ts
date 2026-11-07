import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import * as O from '@/server/org';
export const runtime = 'nodejs';
export const PATCH = handler(async (req, { actor, params }) => { const b = await req.json(); await O.updateProfile(actor, params.id, { name: b.name, billingContact: b.billingContact }); return { ok: true }; });
