import type { ReactNode } from 'react';
import './globals.css';
export const metadata = { title: { default: 'Artwork Studio', template: '%s | Artwork Studio' }, metadataBase: new URL(process.env.APP_URL ?? 'http://localhost:3000') };
export default function Root({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
