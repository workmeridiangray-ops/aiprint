import type { Metadata } from 'next';
import Link from 'next/link';
import { listPlans } from '@/server/public';
import { rupees } from '@/lib/site';
export const metadata: Metadata = { title: 'Vendor plans', description: 'Monthly plans for print businesses.' };
export default async function Plans() {
  const plans = await listPlans();
  return <><h1>Vendor plans</h1><p className="lead">Monthly prepaid plans for print businesses that serve their own customers.</p>
    {plans.length === 0 ? <div className="card">No plans are published yet. <Link href="/contact">Contact us</Link> to ask about availability.</div> :
      <div className="cards">{plans.map(p => <section className="card" key={p.id}><h2>{p.name}</h2><p className="price">{rupees(p.monthlyPricePaise)} <span className="muted">per month</span></p>
        <ul><li>{p.staffSeats} staff {p.staffSeats === 1 ? 'seat' : 'seats'}</li></ul>
        <p><Link className="btn" href={`/vendor-signup?plan=${p.id}`}>Choose {p.name}</Link></p></section>)}</div>}
    <p className="muted">Processing credit is prepaid separately and used when you process work. The price is checked again at checkout.</p></>;
}
