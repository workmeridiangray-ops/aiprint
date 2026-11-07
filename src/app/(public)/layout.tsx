import type { ReactNode } from 'react';
import Link from 'next/link';
export const dynamic = 'force-dynamic';
const NAV: [string, string][] = [['/software', 'Software'], ['/services', 'Services'], ['/how-it-works', 'How it works'], ['/plans', 'Vendor plans'], ['/pricing', 'Pricing'], ['/faq', 'FAQ'], ['/contact', 'Contact']];
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <>
    <a href="#content" className="skip">Skip to content</a>
    <header className="site-head"><div className="wrap"><Link href="/" className="brand">Artwork Studio</Link>
      <nav aria-label="Main"><ul>{NAV.map(([h, l]) => <li key={h}><Link href={h}>{l}</Link></li>)}<li><Link href="/login" className="signin">Sign in</Link></li></ul></nav></div></header>
    <main id="content" className="wrap page">{children}</main>
    <footer className="site-foot"><div className="wrap"><nav aria-label="Policies"><ul>
      <li><Link href="/terms">Terms</Link></li><li><Link href="/privacy">Privacy</Link></li><li><Link href="/refund-policy">Refund policy</Link></li><li><Link href="/acceptable-use">File and acceptable-use policy</Link></li></ul></nav>
      <p className="muted">Artwork preparation for print: supported image files in, print-ready files out.</p></div></footer>
  </>;
}
