import type { Metadata } from 'next';
import Link from 'next/link';
import { getPool } from '@/server/db';
import { rupees } from '@/lib/site';
import SignupForm from './form';
export const metadata: Metadata = { title: 'Register your print business', robots: { index: false } };
export default async function VendorSignup({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  const { plan } = await searchParams;
  const ok = plan && /^[0-9a-f-]{36}$/i.test(plan);
  const p = ok ? (await getPool().query('select id,name,monthly_price_paise,staff_seats from plans where id=$1', [plan])).rows[0] : null;
  return <><h1>Register your print business</h1>
    {!p ? <div className="card" role="alert">Choose a plan first. <Link href="/plans">See vendor plans</Link></div> : <>
      <p className="lead">Plan: {p.name}, {rupees(Number(p.monthly_price_paise))} per month, {p.staff_seats} staff seats.</p>
      <p className="muted">Your store opens after your first subscription payment is confirmed. The price is checked again at checkout.</p><SignupForm planId={p.id} /></>}</>;
}
