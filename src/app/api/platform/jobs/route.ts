import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { jobProblems } from '@/server/admin';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => NextResponse.json(await jobProblems(actor)));
