/* ────────────────────────────────────────────────────────────────────────
   Image file intake — ONE utility for every upload path (ribbon float
   picker, context-menu replace, paste/drop).

   • NO size cap: images are stored as data-URLs inside the note, so the
     real constraint is the auto-fit below — a huge photo is downscaled to
     a print-quality width instead of being rejected.
   • Auto-fit: oversized images are re-encoded through a canvas so the
     document stays light while remaining sharp in PDF/Word (the cap is
     1600px on the long edge ≈ full A4 content width at ~2× DPI).
   • Returns intrinsic + display dimensions so callers never guess.
   ──────────────────────────────────────────────────────────────────────── */

/** longest edge allowed in stored data-URLs (photo-quality, light doc) */
const MAX_EDGE = 1600;

export interface LoadedImage {
  /** PNG→PNG, others→JPEG (screenshots keep their transparency) */
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  aspectRatio: number;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      if (typeof r.result === 'string') resolve(r.result);
      else reject(new Error('خواندن فایل ناموفق بود.'));
    };
    r.onerror = () => reject(new Error('خواندن فایل ناموفق بود.'));
    r.readAsDataURL(file);
  });
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('تصویر قابل خواندن نیست.'));
    img.src = src;
  });
}

/** re-encode through a canvas, keeping the aspect ratio, capped to MAX_EDGE */
function downscale(img: HTMLImageElement, mime: 'image/png' | 'image/jpeg'): string {
  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
  if (scale >= 1) return img.src; /* already within budget */
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return img.src; /* no canvas — original stands */
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL(mime, 0.9);
}

/**
 * Load an image File → { src, dimensions }. Any size accepted; >1600px
 * edges are auto-downscaled (JPEG quality 0.9 / PNG lossless for shots).
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (!file.type.startsWith('image/')) throw new Error('فایل انتخاب‌شده تصویر نیست.');
  const raw = await readAsDataUrl(file);
  const img = await loadImageEl(raw);
  const keepPng = file.type === 'image/png' || file.type === 'image/webp' || raw.startsWith('data:image/png');
  const src = keepPng ? downscale(img, 'image/png') : downscale(img, 'image/jpeg');
  const final = src === raw ? img : await loadImageEl(src);
  return {
    src,
    naturalWidth: final.naturalWidth,
    naturalHeight: final.naturalHeight,
    aspectRatio: (final.naturalWidth || 1) / (final.naturalHeight || 1),
  };
}

/** display dimensions for a floating object: cap to the A4 content width,
 *  never upscale, aspect always locked */
export function floatDimsFor(img: LoadedImage, maxW = 620): { width: number; height: number } {
  const w = Math.min(maxW, img.naturalWidth || maxW);
  const h = Math.round(w / (img.aspectRatio || 1));
  return { width: w, height: Math.max(1, h) };
}

/* ── avatar intake (profile + group) ─────────────────────────────────────
   The server stores avatars as data-URLs inside the User/Group record and
   enforces a hard 150 KB cap at the API layer. Instead of REJECTING bigger
   files (the old «حجم تصویر باید کمتر از ۱۵۰ کیلوبایت باشد» error), every
   upload path now AUTO-FITS: square-crop the image, re-encode through a
   canvas at progressively lower quality until it fits, and return a
   data-URL the server will always accept. Any input size → valid avatar. */

/** hard cap the server enforces on avatar data-URLs (Buffer.byteLength of
 *  the whole data-URL string); we target well under it */
const AVATAR_BUDGET_BYTES = 150 * 1024;

/** center square crop → PNG/WebP keeps transparency; JPEG gets white fill */
function drawSquare(img: HTMLImageElement, size: number, jpeg: boolean): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('پردازش تصویر ممکن نیست.');
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  if (jpeg) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
  }
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return jpeg ? canvas.toDataURL('image/jpeg', 0.85) : canvas.toDataURL('image/png');
}

function dataUrlBytes(url: string): number {
  const base64 = url.slice(url.indexOf(',') + 1);
  return Math.floor((base64.length * 3) / 4);
}

/**
 * Any image File → a server-valid square avatar data-URL.
 * Tries shrinking sizes 512→384→256→192→128 and JPEG quality steps until
 * the result fits the 150 KB budget — the caller NEVER needs a size error.
 */
export async function loadAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('فایل انتخاب‌شده تصویر نیست.');
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => typeof r.result === 'string' && resolve(r.result);
    r.onerror = () => reject(new Error('خواندن فایل ناموفق بود.'));
    r.readAsDataURL(file);
  });
  const img = await loadImageEl(raw);
  const jpeg = !(file.type === 'image/png' || file.type === 'image/webp' || raw.startsWith('data:image/png'));
  for (const size of [512, 384, 256, 192, 128, 96]) {
    for (const quality of jpeg ? [0.85, 0.7, 0.55] : [1]) {
      let url: string;
      if (quality === 1) url = drawSquare(img, size, false);
      else {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('پردازش تصویر ممکن نیست.');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
        url = canvas.toDataURL('image/jpeg', quality);
      }
      if (dataUrlBytes(url) <= AVATAR_BUDGET_BYTES) return url;
    }
  }
  throw new Error('تصویر قابل فشرده‌سازی نیست — تصویر دیگری انتخاب کنید.');
}
