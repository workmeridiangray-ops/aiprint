import Link from 'next/link';
import type { Metadata } from 'next';
import { directStoreSlug } from '@/server/public';
export const metadata: Metadata = { title: 'Prepare artwork for print', description: 'Upload an image, set size and bleed, get a fixed price and download a print-ready file.' };
export default async function Home() {
  const slug = await directStoreSlug();
  return <>
    <h1>Print-ready artwork from your image</h1>
    <p className="lead">Upload a JPG or PNG, set the size and bleed, see the price before you pay, and download a file your printer can use.</p>
    <div className="cards">
      <section className="card"><h2>I need artwork prepared</h2><p>Use the direct store, or go to a print shop that already uses this service.</p>
        {slug ? <p><Link className="btn" href={`/store/${slug}`}>Open the direct store</Link></p> : <p className="muted">The direct store is not open yet.</p>}
        <p><Link href="/login">Sign in</Link></p></section>
      <section className="card"><h2>I run a print business</h2><p>Offer artwork preparation to your own customers under your name, with staff accounts and your own prices.</p>
        <p><Link className="btn" href="/plans">See vendor plans</Link></p><p><Link href="/software">What the software does</Link></p></section>
    </div></>;
}
