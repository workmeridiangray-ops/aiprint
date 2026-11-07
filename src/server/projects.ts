import { z } from 'zod';
import { getPool, tx, AppError } from './db';
import type { Actor } from './auth';
import { require as authorize } from './policy';

export const SettingsSchema = z.object({
  widthMm: z.number().min(1).max(500),
  heightMm: z.number().min(1).max(500),
  bleedMm: z.number().min(0).max(20),
  dpi: z.number().int().min(72).max(1200),
  fit: z.enum(['fit', 'fill']),
  format: z.enum(['png', 'jpg', 'tiff', 'pdf']).default('png'),
  offsetXMm: z.number().default(0),
  offsetYMm: z.number().default(0),
  rotationDeg: z.number().min(-360).max(360).default(0),
  scale: z.number().min(0.05).max(20).default(1),
});
export type Settings = z.infer<typeof SettingsSchema>;
export const MAX_OUTPUT_PIXELS = 80_000_000;

export function outputPixels(s: Settings) {
  const w = Math.round(((s.widthMm + 2 * s.bleedMm) / 25.4) * s.dpi);
  const h = Math.round(((s.heightMm + 2 * s.bleedMm) / 25.4) * s.dpi);
  return { w, h, total: w * h };
}
export function validateSettings(input: unknown): Settings {
  const r = SettingsSchema.safeParse(input);
  if (!r.success) throw new AppError('invalid_settings', r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  if (outputPixels(r.data).total > MAX_OUTPUT_PIXELS) throw new AppError('output_too_large', 'Output including bleed exceeds 80 megapixels');
  return r.data;
}

export async function createProject(actor: Actor, name: string) {
  authorize(actor, 'project.create', { tenantId: actor.tenantId });
  const r = await getPool().query('insert into projects(tenant_id,owner_user_id,name) values($1,$2,$3) returning id,revision', [actor.tenantId, actor.userId, name.slice(0, 120)]);
  return r.rows[0] as { id: string; revision: number };
}

async function loadOwned(c: { query: Function }, actor: Actor, id: string, action: 'project.read' | 'project.save', lock = false) {
  const r = await c.query(`select * from projects where id=$1 ${lock ? 'for update' : ''}`, [id]);
  if (!r.rowCount) throw new AppError('not_found', 'Project not found', 404);
  const row = r.rows[0];
  try { authorize(actor, action, { tenantId: row.tenant_id, ownerUserId: row.owner_user_id }); }
  catch { throw new AppError('not_found', 'Project not found', 404); }
  return row;
}
export async function getProject(actor: Actor, id: string) { return loadOwned(getPool(), actor, id, 'project.read'); }

/** Server-confirmed save. The caller must send the revision it last saw; a mismatch returns a conflict with the current state. */
export async function saveProject(actor: Actor, id: string, expectedRevision: number, patch: { settings?: unknown; sourceFileId?: string | null }) {
  return tx(async c => {
    const row = await loadOwned(c, actor, id, 'project.save', true);
    if (row.revision !== expectedRevision)
      throw Object.assign(new AppError('revision_conflict', 'This project was changed elsewhere', 409), { current: { revision: row.revision, settings: row.settings, sourceFileId: row.source_file_id } });
    let settings = row.settings;
    if (patch.settings !== undefined) settings = validateSettings(patch.settings);
    let sourceFileId = row.source_file_id;
    if (patch.sourceFileId !== undefined) {
      if (patch.sourceFileId) {
        const f = await c.query('select tenant_id, owner_user_id, kind from stored_files where id=$1 and not quarantined', [patch.sourceFileId]);
        if (!f.rowCount || f.rows[0].tenant_id !== actor.tenantId || f.rows[0].owner_user_id !== actor.userId || f.rows[0].kind !== 'original')
          throw new AppError('invalid_source', 'Source file is not available', 400);
      }
      sourceFileId = patch.sourceFileId;
    }
    const u = await c.query('update projects set settings=$2, source_file_id=$3, revision=revision+1, updated_at=now() where id=$1 returning revision', [id, JSON.stringify(settings), sourceFileId]);
    return { revision: u.rows[0].revision as number, savedAt: new Date().toISOString() };
  });
}
