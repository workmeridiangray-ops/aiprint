import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import * as O from '@/server/org';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => O.myOrganisations(actor));
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return O.createOrganisation(actor, String(b.name ?? ''), b.billingContact ? String(b.billingContact) : undefined); });
