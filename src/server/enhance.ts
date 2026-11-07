import { execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { AppError } from './db';
import { LIMITS, readOriginal } from './files';
import type { Actor } from './auth';
import { getProject } from './projects';

/** Enhancement = one nominated library: OpenCV dnn_superres with the pretrained ESPCN model at 2x or 4x (run as a child process).
 *  It sharpens by learned interpolation; it cannot recover detail that is not in the image, and it is not a generative model. */
export const ENHANCE_LIBRARY = 'OpenCV dnn_superres, ESPCN';
const PY = () => process.env.ENHANCE_PYTHON || 'python3';
const SCRIPT = path.join(process.cwd(), 'scripts', 'enhance.py');
const MODELS = path.join(process.cwd(), 'assets', 'models');
export const ENHANCE_MAX_PIXELS = LIMITS.maxPixels; // enlarged image must stay inside the decoder limit the export engine uses
export const factorOf = (e: string) => (e === '4x' ? 4 : e === '2x' ? 2 : 0);

let probe: { at: number; ok: boolean } | null = null;
/** True when python3 + OpenCV dnn_superres + the model files are present. Cached for a minute. */
export async function enhanceAvailable(force = false): Promise<boolean> {
  if (!force && probe && Date.now() - probe.at < 60_000) return probe.ok;
  const ok = await new Promise<boolean>(res => {
    execFile(PY(), ['-c', 'import cv2; cv2.dnn_superres.DnnSuperResImpl_create()'], { timeout: 20_000 }, err => res(!err));
  }) && await Promise.all(['ESPCN_x2.pb', 'ESPCN_x4.pb'].map(f => fsp.access(path.join(MODELS, f)).then(() => true, () => false))).then(a => a.every(Boolean));
  probe = { at: Date.now(), ok };
  return ok;
}

/** Enlarge a PNG by 2 or 4. Throws a plain error on failure (the job then fails and the hold is released). */
export async function enhanceImage(png: Buffer, factor: 2 | 4): Promise<Buffer> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'enh-'));
  const inP = path.join(dir, 'in.png'), outP = path.join(dir, 'out.png');
  try {
    await fsp.writeFile(inP, png);
    await new Promise<void>((resolve, reject) => {
      execFile(PY(), [SCRIPT, inP, outP, String(factor), MODELS], { timeout: 180_000, maxBuffer: 1 << 20 }, (err, _o, stderr) => {
        if (err) return reject(new Error(`enhancement failed${(err as any).code === 2 ? ' (not installed on this server)' : ''}: ${String(stderr || err.message).slice(0, 300)}`));
        resolve();
      });
    });
    return await fsp.readFile(outP);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
}

/** Reject before any price is given or money is held when enhancement cannot run or would be too large. */
export async function assertEnhanceUsable(settingsEnhance: string, srcW: number, srcH: number) {
  const f = factorOf(settingsEnhance); if (!f) return;
  if (srcW * srcH * f * f > ENHANCE_MAX_PIXELS) throw new AppError('enhance_too_large', `This image is too large to enlarge ${f} times (the enlarged image would exceed ${ENHANCE_MAX_PIXELS / 1e6} megapixels). Choose a smaller factor or turn enhancement off.`);
  if (!(await enhanceAvailable())) throw new AppError('enhance_unavailable', 'Image enhancement is not available on this server right now. Turn it off, or ask support.', 503);
}

/** Before/after on a small centre crop so the customer can judge the effect before paying. "Before" is a plain Lanczos enlargement. */
export async function enhancePreview(actor: Actor, projectId: string, factor: 2 | 4) {
  const p = await getProject(actor, projectId);
  if (!p.source_file_id) throw new AppError('no_source', 'Add an image first');
  if (!(await enhanceAvailable())) throw new AppError('enhance_unavailable', 'Image enhancement is not available on this server right now.', 503);
  const src = await readOriginal(actor, p.source_file_id);
  const img = sharp(src, { limitInputPixels: LIMITS.maxPixels, failOn: 'error' }).rotate().toColourspace('srgb').removeAlpha();
  const m = await sharp(await img.clone().png().toBuffer()).metadata();
  const side = 96, w = Math.min(side, m.width!), h = Math.min(side, m.height!);
  const crop = await img.extract({ left: Math.floor((m.width! - w) / 2), top: Math.floor((m.height! - h) / 2), width: w, height: h }).png().toBuffer();
  const after = await enhanceImage(crop, factor);
  const before = await sharp(crop).resize(w * factor, h * factor, { kernel: 'lanczos3' }).png().toBuffer();
  const uri = (b: Buffer) => `data:image/png;base64,${b.toString('base64')}`;
  return { factor, cropPx: [w, h], library: ENHANCE_LIBRARY, before: uri(before), after: uri(after) };
}
