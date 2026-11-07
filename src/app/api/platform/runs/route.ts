import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { lastRuns } from '@/server/retention';
import { emailHealth } from '@/server/mailer';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor }) => NextResponse.json({ ...(await lastRuns(actor)), email: await emailHealth(actor) }));
