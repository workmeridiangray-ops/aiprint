import type { Metadata } from 'next';
import { getPortal } from '@/server/vendor';
import RegisterForm from './form';
export const metadata: Metadata = { title: 'Create an account', robots: { index: false } };
export default async function Register({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const { store } = await searchParams; const p = store ? await getPortal(store).catch(() => null) : null;
  return <><h1>Create an account</h1>
    {!p ? <div className="card" role="alert">Choose a store first. Open your print shop's address, or the direct store, and select "Create an account".</div> : <><p className="lead">Account for {p.displayName}</p><RegisterForm storeSlug={store!} /></>}</>;
}
