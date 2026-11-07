import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { listLibrary } from '@/server/retention';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => NextResponse.json(await listLibrary(actor)));
