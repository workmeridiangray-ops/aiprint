import { handler } from '@/server/http';
import { AppError } from '@/server/db';
import * as s from '@/server/support';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor, params }) => {
  const b = await req.json().catch(() => ({})); const id = params.id; const str = (v: unknown) => String(v ?? '');
  switch (params.action) {
    case 'reply': await s.reply(actor, id, str(b.body)); break;
    case 'note': await s.addNote(actor, id, str(b.body)); break;
    case 'assign': await s.assign(actor, id, str(b.assigneeId)); break;
    case 'escalate': await s.escalate(actor, id, str(b.reason), str(b.ownerId)); break;
    case 'resolve': await s.resolve(actor, id, str(b.resolution), str(b.evidence)); break;
    case 'reopen': await s.reopen(actor, id); break;
    case 'close': await s.close(actor, id); break;
    default: throw new AppError('not_found', 'Unknown action', 404);
  }
  return { ok: true };
});
