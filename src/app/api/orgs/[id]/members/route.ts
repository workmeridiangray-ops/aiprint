import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import * as O from '@/server/org';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor, params }) => ({ ...(await O.listMembers(actor, params.id)), balance: await O.orgBalance(actor, params.id) }));
