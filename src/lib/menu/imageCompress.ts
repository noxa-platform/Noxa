/**
 * 画像圧縮ユーティリティ（host-menu-app から移植）。
 * File を長辺 maxSize に収め JPEG quality で再エンコードした data:URL を返す。
 * Firestore（menu_images）に格納するため軽量化する。
 */

const DEFAULTS = { maxSize: 1280, quality: 0.82, mimeType: 'image/jpeg' };

function loadImageFromFile(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export function dataUrlByteSize(dataUrl: string): number {
  if (!dataUrl) return 0;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl.length;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

export async function compressImage(input: File | Blob, options: Partial<typeof DEFAULTS> = {}): Promise<string> {
  const opt = { ...DEFAULTS, ...options };
  const img = await loadImageFromFile(input);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (!w || !h) throw new Error('画像サイズを取得できません');

  const longSide = Math.max(w, h);
  const scale = longSide > opt.maxSize ? opt.maxSize / longSide : 1;
  const targetW = Math.round(w * scale);
  const targetH = Math.round(h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context が取得できません');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, targetW, targetH);
  return canvas.toDataURL(opt.mimeType, opt.quality);
}
