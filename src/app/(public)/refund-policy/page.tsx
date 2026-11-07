import type { Metadata } from 'next';
import Link from 'next/link';
import { getPolicy } from '@/server/public';
export const metadata: Metadata = { title: 'Refund policy', description: 'When refunds apply and who decides.' };
export default async function Page() {
  const p = await getPolicy('refund');
  return <><h1>Refund policy</h1>
    {!p ? <div className="card" role="status"><p>This policy has not been published yet. If you need it before then, please <Link href="/contact">contact us</Link>.</p></div> : <>
      <p className="muted">Version {p.version}, effective {p.effectiveDate}</p>
      <div className="policy">{p.body.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}</div></>}</>;
}
