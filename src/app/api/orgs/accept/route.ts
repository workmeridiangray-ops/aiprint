import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import * as O from '@/server/org';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => O.acceptInvite(actor, String((await req.json()).token ?? '')));
