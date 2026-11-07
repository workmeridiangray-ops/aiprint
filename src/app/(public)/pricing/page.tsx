import type { Metadata } from 'next';
import Link from 'next/link';
import { directPricing } from '@/server/public';
import { rupees } from '@/lib/site';
export const metadata: Metadata = { title: 'Pricing', description: 'Direct store prices for artwork preparation.' };
export default async function Pricing() {
  const p = await directPricing();
  const ex = (w: number, h: number) => { const mp = ((w + 6) / 25.4 * 300) * ((h + 6) / 25.4 * 300) / 1e6; return { mp, price: Math.max(p!.minPaise, Math.ceil(mp * p!.perMpPaise)) }; };
  return <><h1>Direct store pricing</h1>
    {!p ? <div className="card">Prices for the direct store have not been published yet.</div> : <>
      <p className="lead">Charged per job by output size: {rupees(p.perMpPaise)} per megapixel, minimum {rupees(p.minPaise)} per job.</p>
      <table className="table"><caption className="muted">Examples at 300 dpi with 3 mm bleed</caption><thead><tr><th scope="col">Size</th><th scope="col">Megapixels</th><th scope="col">Price</th></tr></thead><tbody>
        {([['A6', 105, 148], ['A5', 148, 210], ['A4', 210, 297], ['A3', 297, 420]] as const).map(([n, w, h]) => { const e = ex(w, h); return <tr key={n}><td>{n} ({w} × {h} mm)</td><td>{e.mp.toFixed(1)}</td><td>{rupees(e.price)}</td></tr>; })}</tbody></table>
      <p className="muted">You always see the exact price before you confirm. It is valid for 15 minutes.</p>
      <p><Link className="btn" href={`/store/${p.slug}`}>Start a project</Link></p></>}</>;
}
