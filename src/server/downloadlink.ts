import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from './db';
import type { Actor } from './auth';
import { authoriseOutput } from './worker';

/** Short-lived download links (WF-10). A link is bound to one output and one signed-in user, and every use re-checks access, retention and revocation. */
export const LINK_TTL_SECONDS = 300;

function secret(): string {
  const s = process.env.DOWNLOAD_LINK_SECRET;
  if (s) return s;
  if (process.env.APP_ENV === 'production' || process.env.APP_ENV === 'staging') throw new AppError('download_not_configured', 'DOWNLOAD_LINK_SECRET is required', 503);
  return 'dev-only-download-secret';
}
const mac = (body: string) => createHmac('sha256', secret()).update(body).digest('base64url');

export function signLink(outputId: string, userId: string, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + LINK_TTL_SECONDS;
  const body = `${outputId}.${userId}.${exp}`;
  return { token: `${exp}.${mac(body)}`, expiresAt: new Date(exp * 1000).toISOString() };
}
export function verifyLink(token: string | null, outputId: string, userId: string, nowMs = Date.now()) {
  const m = /^(\d{9,12})\.([A-Za-z0-9_-]{20,})$/.exec(token ?? '');
  if (!m) throw new AppError('link_invalid', 'This download link is not valid. Request a new one.', 403);
  const want = Buffer.from(mac(`${outputId}.${userId}.${m[1]}`)), got = Buffer.from(m[2]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) throw new AppError('link_invalid', 'This download link is not valid. Request a new one.', 403);
  if (Number(m[1]) * 1000 < nowMs) throw new AppError('link_expired', 'This download link has expired. Request a new one.', 410);
}
export async function issueDownloadLink(actor: Actor, outputId: string) {
  await authoriseOutput(actor, outputId); // same checks as a download, without reading the file
  const { token, expiresAt } = signLink(outputId, actor.userId);
  return { url: `/api/outputs/${outputId}/download?t=${token}`, expiresAt };
}
