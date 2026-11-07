import Link from 'next/link';
import type { Metadata } from 'next';
import { FACTS } from '@/lib/site';
export const metadata: Metadata = { title: 'Software overview', description: 'What the artwork preparation software does, and its limits.' };
export default function Software() {
  return <><h1>Software overview</h1>
    <p className="lead">A web editor and processing service for preparing supported image artwork for print.</p>
    <h2>What you can do</h2><ul>
      <li>Upload a {FACTS.formats} image and see a print preview with trim, bleed and safe-area guides.</li>
      <li>Set the size (up to {FACTS.maxSideMm} mm per side), bleed and resolution. Move, rotate, scale, fit or fill the image.</li>
      <li>Get a fixed price before anything is charged. Prices expire after {FACTS.quoteMinutes} minutes or when you change the artwork.</li>
      <li>Download the result as {FACTS.outputs}.</li>
      <li>Print shops get their own store, staff accounts, customer prices and a counter screen for walk-in work.</li></ul>
    <h2>Limits</h2><ul>
      <li>Input: {FACTS.formats}, up to {FACTS.maxMb} MB and {FACTS.maxMp} megapixels per image.</li>
      <li>Output including bleed is limited to {FACTS.maxOutputMp} megapixels.</li>
      <li>Bleed is made by mirroring the edges of your own image. Detail that is not in the image cannot be added back.</li>
      <li>Files are RGB. CMYK output, PDF input and vector editing are not part of this service.</li></ul>
    <p><Link className="btn" href="/how-it-works">How it works</Link> <Link href="/plans">Vendor plans</Link></p></>;
}
