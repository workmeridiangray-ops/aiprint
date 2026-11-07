import sharp from 'sharp';
import type { Metadata } from 'sharp';
import { createHash, randomUUID } from 'node:crypto';
import { getPool, AppError } from './db';
import type { Actor } from './auth';
import { require as authorize } from './policy';
import { canReadProject } from './org';
import { storage, StorageMissing } from './storage';

export const LIMITS = { maxBytes: 25 * 1024 * 1024, maxPixels: 40_000_000, formats: ['jpeg', 'png'] as const };

export type Inspection = { format: 'jpeg' | 'png'; width: number; height: number; hasProfile: boolean; sha256: string; bytes: number };

/** Inspects bytes under resource limits. Decoding is bounded via sharp's limitInputPixels; the file is never trusted by name/MIME. */
export async function inspectImage(buf: Buffer): Promise<Inspection> {
  if (buf.length === 0) throw new AppError('empty_file', 'The file is empty');
  if (buf.length > LIMITS.maxBytes) throw new AppError('file_too_large', 'Images can be at most 25 MB');
  let meta: Metadata;
  try { meta = await sharp(buf, { limitInputPixels: LIMITS.maxPixels, failOn: 'error' }).metadata(); }
  catch { throw new AppError('unreadable_image', 'This file could not be read as a JPG or PNG image, or it exceeds 40 megapixels'); }
  if (!meta.format || !(LIMITS.formats as readonly string[]).includes(meta.format)) throw new AppError('unsupported_format', 'Only JPG and PNG images are supported');
  if (!meta.width || !meta.height) throw new AppError('unreadable_image', 'Image dimensions could not be determined');
  if (meta.width * meta.height > LIMITS.maxPixels) throw new AppError('too_many_pixels', 'Images can be at most 40 megapixels');
  // Force a full decode of header-validated data to catch truncated files, still pixel-limited.
  try { await sharp(buf, { limitInputPixels: LIMITS.maxPixels, failOn: 'error' }).resize(8, 8, { fit: 'inside' }).raw().toBuffer(); }
  catch { throw new AppError('corrupt_image', 'This image appears to be damaged'); }
  return { format: meta.format as 'jpeg' | 'png', width: meta.width, height: meta.height, hasProfile: !!meta.icc, sha256: createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
}

export async function saveOriginal(actor: Actor, buf: Buffer) {
  authorize(actor, 'file.upload', { tenantId: actor.tenantId });
  const insp = await inspectImage(buf);
  const key = `${actor.tenantId}/${randomUUID()}.${insp.format === 'jpeg' ? 'jpg' : 'png'}`;
  await storage().put(key, buf);
  const r = await getPool().query(
    `insert into stored_files(tenant_id,owner_user_id,kind,storage_key,sha256,bytes,width_px,height_px,format)
     values($1,$2,'original',$3,$4,$5,$6,$7,$8) returning id`,
    [actor.tenantId, actor.userId, key, insp.sha256, insp.bytes, insp.width, insp.height, insp.format]);
  return { fileId: r.rows[0].id as string, ...insp, colourProfile: insp.hasProfile ? 'embedded' : 'untagged' };
}

export async function readOriginal(actor: Actor, fileId: string) {
  const r = await getPool().query('select tenant_id, owner_user_id, storage_key, quarantined from stored_files where id=$1', [fileId]);
  // Same error for missing and forbidden so ids cannot be probed.
  if (!r.rowCount || r.rows[0].quarantined) throw new AppError('not_found', 'File not found', 404);
  const row = r.rows[0];
  const refs = (await getPool().query('select tenant_id, owner_user_id, org_id, visibility from projects where source_file_id=$1', [fileId])).rows;
  let ok = false;
  try { authorize(actor, 'file.read', { tenantId: row.tenant_id, ownerUserId: row.owner_user_id }); ok = true; } catch { /* maybe shared through an organisation project */ }
  if (ok) { for (const p of refs) if (p.org_id && !(await canReadProject(getPool(), actor, p))) { ok = false; break; } } // owner who left the organisation loses organisation files
  if (!ok) for (const p of refs) if (p.org_id && p.visibility === 'shared' && (await canReadProject(getPool(), actor, p))) { ok = true; break; }
  if (!ok) throw new AppError('not_found', 'File not found', 404);
  return storage().get(row.storage_key).catch(e => { throw e instanceof StorageMissing ? new AppError('file_missing', 'The stored file could not be found. Support has been alerted.', 500) : e; });
}

/** Deletes a live copy. A file that is already gone counts as deleted (safe to rerun after a crash). Any other failure is thrown. */
export async function deleteStored(storageKey: string) { await storage().remove(storageKey); }
