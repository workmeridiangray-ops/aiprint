import type { Metadata } from 'next';
import Link from 'next/link';
import { FACTS } from '@/lib/site';
import { directStoreSlug } from '@/server/public';
export const metadata: Metadata = { title: 'Services', description: 'Supported inputs, outputs and limitations of the artwork preparation service.' };
export default async function Services() {
  const slug = await directStoreSlug();
  return <><h1>Services</h1>
    <section className="card"><h2>Print artwork preparation</h2>
      <dl><dt>Supported inputs</dt><dd>{FACTS.formats}, up to {FACTS.maxMb} MB and {FACTS.maxMp} megapixels.</dd>
        <dt>Outputs</dt><dd>{FACTS.outputs}.</dd>
        <dt>Includes</dt><dd>Size and bleed set-up, placement, resolution check, and a validated export file.</dd>
        <dt>Limitations</dt><dd>One source image per project today. No PDF input, no multipage files, no CMYK, no vector editing, no guarantee of results on every press.</dd></dl>
      {slug ? <p><Link className="btn" href={`/store/${slug}`}>Start in the direct store</Link></p> : <p className="muted">The direct store is not open yet. Print shops using this service have their own store addresses.</p>}</section></>;
}
