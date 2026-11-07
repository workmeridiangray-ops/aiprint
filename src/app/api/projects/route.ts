import { handler } from '@/server/http';
import { createProject } from '@/server/projects';
import { getPool } from '@/server/db';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => createProject(actor, String((await req.json()).name ?? 'Untitled')));
export const GET = handler(async (_r, { actor }) =>
  (await getPool().query('select id,name,revision,updated_at from projects where tenant_id=$1 and owner_user_id=$2 order by updated_at desc limit 100', [actor.tenantId, actor.userId])).rows);
