import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { myTransactions } from '@/server/retention';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => NextResponse.json(await myTransactions(actor)));
