import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AppError } from './db';

/** Private object storage. Keys are server-generated; nothing here is ever public or pre-signed. */
export interface Storage { readonly kind: 'local' | 's3'; put(key: string, data: Buffer): Promise<void>; get(key: string): Promise<Buffer>; remove(key: string): Promise<void> }
export class StorageMissing extends Error { constructor(key: string) { super(`stored object not found: ${key}`); } }

const KEY = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;
export function checkKey(key: string) {
  if (!KEY.test(key) || key.split('/').some(s => s === '..' || s === '.' || s === '')) throw new Error('invalid storage key');
  return key;
}
const prod = () => process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging';

function local(): Storage {
  const root = path.resolve(process.env.STORAGE_LOCAL_DIR ?? './.data/files');
  const at = (key: string) => path.join(root, checkKey(key));
  return {
    kind: 'local',
    async put(key, data) { const f = at(key); await mkdir(path.dirname(f), { recursive: true }); await writeFile(f, data, { flag: 'wx' }); },
    async get(key) { try { return await readFile(at(key)); } catch (e: any) { if (e?.code === 'ENOENT') throw new StorageMissing(key); throw e; } },
    async remove(key) { try { await unlink(at(key)); } catch (e: any) { if (e?.code !== 'ENOENT') throw e; } }, // already gone = deleted (safe to rerun)
  };
}

function s3(): Storage {
  const bucket = process.env.S3_BUCKET, region = process.env.S3_REGION ?? 'us-east-1', endpoint = process.env.S3_ENDPOINT;
  if (!bucket) throw new AppError('storage_not_configured', 'S3_BUCKET is not set', 503);
  if (prod() && endpoint && !endpoint.startsWith('https://')) throw new AppError('storage_not_configured', 'S3_ENDPOINT must use https in production', 503);
  const creds = process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '' } : undefined; // else the provider's default chain (e.g. an instance role)
  const client = new S3Client({ region, endpoint, forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true', credentials: creds, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 4 });
  const sse = process.env.S3_SSE as 'AES256' | 'aws:kms' | undefined;
  return {
    kind: 's3',
    async put(key, data) { await client.send(new PutObjectCommand({ Bucket: bucket, Key: checkKey(key), Body: data, ContentType: 'application/octet-stream', ServerSideEncryption: sse })); },
    async get(key) {
      try { const r = await client.send(new GetObjectCommand({ Bucket: bucket, Key: checkKey(key) })); return Buffer.from(await r.Body!.transformToByteArray()); }
      catch (e: any) { if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404) throw new StorageMissing(key); throw e; }
    },
    async remove(key) { await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: checkKey(key) })); }, // S3 delete is idempotent
  };
}

let cached: { sig: string; s: Storage } | null = null;
/** Fails closed: production and staging never fall back to local disk. */
export function storage(): Storage {
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  if (driver === 'local' && prod()) throw new AppError('storage_not_configured', 'Private object storage is not configured for production', 503);
  if (driver !== 'local' && driver !== 's3') throw new AppError('storage_not_configured', `Unknown STORAGE_DRIVER "${driver}"`, 503);
  const sig = JSON.stringify([driver, process.env.STORAGE_LOCAL_DIR, process.env.S3_BUCKET, process.env.S3_REGION, process.env.S3_ENDPOINT, process.env.S3_ACCESS_KEY_ID, process.env.S3_FORCE_PATH_STYLE, process.env.S3_SSE]);
  if (!cached || cached.sig !== sig) cached = { sig, s: driver === 's3' ? s3() : local() };
  return cached.s;
}

/** Writes, reads back, compares and deletes a probe object. Run it against the real bucket before go-live. */
export async function checkStorage() {
  const s = storage(); const key = `health-check/${randomUUID()}.txt`; const body = Buffer.from('probe ' + new Date().toISOString());
  await s.put(key, body); const back = await s.get(key); await s.remove(key);
  if (!back.equals(body)) throw new Error('storage read-back did not match what was written');
  let gone = false; try { await s.get(key); } catch (e) { gone = e instanceof StorageMissing; }
  if (!gone) throw new Error('storage object still readable after delete');
  return { driver: s.kind };
}
