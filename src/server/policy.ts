import { AppError } from './db';
import type { Actor } from './auth';

export type Action =
  | 'project.create' | 'project.read' | 'project.save' | 'file.upload' | 'file.read'
  | 'quote.create' | 'quote.reserve' | 'ledger.read_own' | 'ledger.read_vendor';

/** Deny by default. Rules apply only inside the actor's own tenant; ownership is required for customer artwork.
 *  Staff roles deliberately get NO artwork-file access here (support access needs an approved, time-limited grant: not yet built). */
export function can(actor: Actor, action: Action, res: { tenantId: string; ownerUserId?: string }): boolean {
  if (actor.tenantId !== res.tenantId) return false;
  const own = res.ownerUserId === actor.userId;
  switch (action) {
    case 'project.create': case 'file.upload': case 'quote.create': case 'quote.reserve':
      return actor.role === 'customer' || actor.role === 'vendor_counter';
    case 'project.read': case 'project.save': case 'file.read':
      return (actor.role === 'customer' || actor.role === 'vendor_counter') && own;
    case 'ledger.read_own': return actor.role === 'customer' && own;
    case 'ledger.read_vendor': return actor.role === 'vendor_admin' || actor.role === 'vendor_finance';
    default: return false;
  }
}
export function require(actor: Actor, action: Action, res: { tenantId: string; ownerUserId?: string }) {
  if (!can(actor, action, res)) throw new AppError('denied', 'Not permitted', 403);
}
