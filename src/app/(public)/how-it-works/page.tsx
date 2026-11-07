import Link from 'next/link';
import type { Metadata } from 'next';
import { FACTS } from '@/lib/site';
export const metadata: Metadata = { title: 'How it works', description: 'Upload, edit, price, pay and download in five steps.' };
export default function How() {
  return <><h1>How it works</h1>
    <ol className="steps">
      <li><strong>Upload.</strong> Add a {FACTS.formats} image. We check it before anything else happens.</li>
      <li><strong>Set up.</strong> Choose size, bleed and resolution, and place the image on the preview. Changes save automatically.</li>
      <li><strong>See the price.</strong> You get a fixed price that lasts {FACTS.quoteMinutes} minutes. Changing the artwork or settings needs a new price. Nothing is charged by looking at the preview.</li>
      <li><strong>Confirm.</strong> Funds are held, then the file is prepared. If preparation fails you are not charged.</li>
      <li><strong>Download.</strong> The file stays available for {FACTS.retentionDays} days and you can download it again without paying again.</li></ol>
    <p className="muted">Any change to the image or settings, including a different size, is a new job with a new price.</p>
    <p><Link className="btn" href="/">Get started</Link> <Link href="/plans">Print shops: see plans</Link></p></>;
}
