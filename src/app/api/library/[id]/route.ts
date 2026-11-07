import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { requestDeletion } from '@/server/retention';
export const runtime = 'nodejs';
export const DELETE = handler(async (_r, { actor, params }) => NextResponse.json(await requestDeletion(actor, params.id)));
