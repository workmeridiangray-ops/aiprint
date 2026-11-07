import { handler } from '@/server/http';
import { getProject, saveProject } from '@/server/projects';
export const runtime = 'nodejs';
export const GET = handler(async (_r, { actor, params }) => {
  const p = await getProject(actor, params.id);
  return { id: p.id, name: p.name, revision: p.revision, settings: p.settings, sourceFileId: p.source_file_id, orgId: p.org_id, visibility: p.visibility, mine: p.owner_user_id === actor.userId };
});
export const PATCH = handler(async (req, { actor, params }) => {
  const b = await req.json();
  if (!Number.isInteger(b.revision)) throw new (await import('@/server/db')).AppError('invalid_request', 'revision is required');
  return saveProject(actor, params.id, b.revision, { settings: b.settings, sourceFileId: b.sourceFileId });
});
