import type { Metadata } from 'next';
import Link from 'next/link';
import { getPolicy } from '@/server/public';
export const metadata: Metadata = { title: 'File and acceptable-use policy', description: 'Rules for the files you may upload.' };
export default async function Page() {
  const p = await getPolicy('acceptable_use');
  return <><h1>File and acceptable-use policy</h1>
    {!p ? <div className="card" role="status"><p>This policy has not been published yet. If you need it before then, please <Link href="/contact">contact us</Link>.</p></div> : <>
      <p className="muted">Version {p.version}, effective {p.effectiveDate}</p>
      <div className="policy">{p.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}</div></>}</>;
}
