import { NextResponse } from 'next/server';
import { handler } from '@/server/http';
import { submitEnquiry } from '@/server/public';
export const runtime = 'nodejs';
export const POST = handler(async req => {
  const b = await req.json().catch(() => ({}));
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'; // deploy behind a proxy that sets this
  try { return await submitEnquiry(b, fwd); }
  catch (e: any) { if (e.fields) return NextResponse.json({ error: e.code, message: e.message, fields: e.fields }, { status: 422 }); throw e; }
}, { public: true });
