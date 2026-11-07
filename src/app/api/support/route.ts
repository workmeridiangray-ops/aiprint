import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { createTicket, listTickets } from '@/server/support';
export const runtime = 'nodejs';
export const GET = handler(async (req, { actor }) => NextResponse.json(await listTickets(actor, req.nextUrl.searchParams.get('status') ?? undefined)));
export const POST = handler(async (req, { actor }) => { const b = await req.json(); return createTicket(actor, { category: String(b.category ?? ''), subject: String(b.subject ?? ''), body: String(b.body ?? ''), linkType: b.linkType ?? null, linkId: b.linkId ?? null }); });
