/**
 * 画像圧縮ユーティリティ（host-menu-app から移植）。
 * File を長辺 maxSize に収め JPEG quality で再エンコードした data:URL を返す。
 * Firestore（menu_images）に格納するため軽量化する。
 */

// maxBytes: Firestore は 1 ドキュメント 1 MiB 上限。data URL は base64 で約 1.33 倍に膨らみ、
// 画像は他フィールドと同居する doc に入るため、余裕を見て 900KB を既定上限にする。
const DEFAULTS = { maxSize: 1280, quality: 0.82, mimeType: 'image/jpeg', maxBytes: 900 * 1024 };

/**
 * 品質ラダー（純関数・テスト対象）。start 未満の品質を段階的に下げた列を返す。
 * compressImage が maxBytes を超えたとき、この順で再エンコードして上限内に収める。
 */
export function qualityLadder(start: number): number[] {
  const steps = [0.7, 0.6, 0.5, 0.42, 0.35, 0.28];
  return steps.filter((q) => q < start);
}

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

  // まず既定品質でエンコードし、maxBytes を超えていれば品質ラダーで段階的に再エンコード
  // （同一 canvas からの再エンコードは再描画不要で軽い）。Firestore の doc 上限超過で
  // setDoc が throw して保存に失敗するのを防ぐ。ラダーを使い切っても超過する場合は
  // 最小品質版（最も小さい）を返す＝throw より保存を優先する。
  let dataUrl = canvas.toDataURL(opt.mimeType, opt.quality);
  if (dataUrlByteSize(dataUrl) > opt.maxBytes) {
    for (const q of qualityLadder(opt.quality)) {
      dataUrl = canvas.toDataURL(opt.mimeType, q);
      if (dataUrlByteSize(dataUrl) <= opt.maxBytes) break;
    }
  }
  return dataUrl;
}
