import type { ReactNode } from 'react';
import './globals.css';
export const metadata = { title: 'Artwork Studio' };
export default function Root({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
