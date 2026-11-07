import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { getTicket } from '@/server/support';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor, params }) => NextResponse.json(await getTicket(actor, params.id)));
