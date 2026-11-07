import type { Metadata } from 'next';
import Link from 'next/link';
import { FACTS } from '@/lib/site';
export const metadata: Metadata = { title: 'FAQ', description: 'Answers about file types, limits, prices and downloads.' };
const QA: [string, string][] = [
  ['Which files can I upload?', `${FACTS.formats} images up to ${FACTS.maxMb} MB and ${FACTS.maxMp} megapixels. PDFs, other formats and multipage files are not accepted.`],
  ['What files do I get back?', `${FACTS.outputs}.`],
  ['Is CMYK supported?', 'Not at the moment. Exported files are RGB.'],
  ['Can you add detail to a low-resolution image?', 'No. The editor warns you when the image will print below about 150 dpi at your chosen size, but it cannot recover detail that is not in the image.'],
  ['How is bleed made?', 'By mirroring the edges of your image outward. Nothing is generated or invented.'],
  ['When am I charged?', `After you confirm a price. The price is fixed for ${FACTS.quoteMinutes} minutes. If the file cannot be prepared you are not charged.`],
  ['Can I download again?', `Yes, for ${FACTS.retentionDays} days after the file is prepared, without paying again. Changing the image or settings is a new job and a new price.`],
  ['How long are files kept?', `Prepared files are kept for ${FACTS.retentionDays} days. See the privacy page for the approved policy.`],
  ['How do I get a refund?', 'See the refund policy page, or contact us with your job details.'],
];
export default function Faq() {
  return <><h1>Frequently asked questions</h1>
    {QA.map(([q, a]) => <details className="card" key={q}><summary><strong>{q}</strong></summary><p>{a}</p></details>)}
    <p>Still need help? <Link href="/contact">Send us an enquiry</Link>.</p></>;
}
