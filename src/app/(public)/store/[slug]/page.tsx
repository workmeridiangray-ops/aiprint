import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getPortal } from '@/server/vendor';
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const p = await getPortal(slug).catch(() => null);
  return { title: p ? p.displayName : 'Store not found', description: p ? `Artwork preparation from ${p.displayName}.` : undefined, robots: p ? undefined : { index: false } };
}
export default async function Store({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params; const p = await getPortal(slug).catch(() => null); if (!p) notFound();
  return <div style={{ ['--teal' as string]: p.primaryColour }}><h1>{p.displayName}</h1>
    <p className="lead">Prepare your artwork for print. Upload an image, see the price, and download your file.</p>
    <div className="cards"><section className="card"><h2>New here</h2><p><Link className="btn" href={`/register?store=${encodeURIComponent(slug)}`}>Create an account</Link></p></section>
      <section className="card"><h2>Already registered</h2><p><Link className="btn" href="/login">Sign in</Link></p></section></div></div>;
}
