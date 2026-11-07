// Pure and dependency-free: shared by the server export engine and the browser preview so both place the image identically.
export type Place = { widthMm: number; heightMm: number; bleedMm: number; dpi: number; fit: 'fit' | 'fill'; offsetXMm: number; offsetYMm: number; rotationDeg: number; scale: number };
const px = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);

export function placement(srcW: number, srcH: number, s: Place) {
  const bleed = px(s.bleedMm, s.dpi);
  const outW = px(s.widthMm + 2 * s.bleedMm, s.dpi), outH = px(s.heightMm + 2 * s.bleedMm, s.dpi);
  const trimW = outW - 2 * bleed, trimH = outH - 2 * bleed;
  const a = (s.rotationDeg * Math.PI) / 180;
  const rw = Math.abs(srcW * Math.cos(a)) + Math.abs(srcH * Math.sin(a));
  const rh = Math.abs(srcW * Math.sin(a)) + Math.abs(srcH * Math.cos(a));
  const base = s.fit === 'fill' ? Math.max(trimW / rw, trimH / rh) : Math.min(trimW / rw, trimH / rh);
  const total = base * s.scale; // output pixels per source pixel
  const nw = Math.max(1, Math.round(rw * total)), nh = Math.max(1, Math.round(rh * total));
  const left = Math.round((trimW - nw) / 2 + (s.offsetXMm / 25.4) * s.dpi);
  const top = Math.round((trimH - nh) / 2 + (s.offsetYMm / 25.4) * s.dpi);
  return { bleed, outW, outH, trimW, trimH, nw, nh, left, top, total, effectiveDpi: s.dpi / total };
}
export const LOW_DPI_WARN = 150; // below this, print quality is likely visibly soft
export const dpiLevel = (e: number) => (e >= 240 ? 'good' : e >= LOW_DPI_WARN ? 'ok' : 'low');
