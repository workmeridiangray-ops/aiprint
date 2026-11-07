import { handler } from '@/server/http';
import { createProject } from '@/server/projects';
import { getPool } from '@/server/db';
export const runtime = 'nodejs';
export const POST = handler(async (req, { actor }) => (async () => { const b = await req.json(); return createProject(actor, String(b.name ?? 'Untitled'), b.orgId ? String(b.orgId) : undefined); })());
export const GET = handler(async (_r, { actor }) =>
  (await getPool().query('select p.id,p.name,p.revision,p.updated_at,p.org_id,p.visibility,o.name as org_name, (p.owner_user_id=$2) as mine from projects p left join organisations o on o.id=p.org_id where p.tenant_id=$1 and ((p.owner_user_id=$2 and (p.org_id is null or exists (select 1 from org_members m where m.org_id=p.org_id and m.user_id=$2 and m.revoked_at is null))) or (p.visibility=\'shared\' and exists (select 1 from org_members m where m.org_id=p.org_id and m.user_id=$2 and m.revoked_at is null))) order by p.updated_at desc limit 100', [actor.tenantId, actor.userId])).rows);
