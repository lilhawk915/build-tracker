/** Job-site camera helpers: shrink a phone photo before upload, and ask the phone where it is. */

const MAX_EDGE = 2000;   // long edge in px: sharp on a laptop, ~400-700 KB instead of 3-6 MB
const QUALITY = 0.82;

/** Resize an image to MAX_EDGE as JPEG. PDFs and anything the browser can't decode pass through untouched. */
export async function shrinkPhoto(f: File): Promise<File> {
  if (!f.type.startsWith('image/') || f.type === 'image/gif') return f;
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * k), h = Math.round(bmp.height * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= f.size) return f;
    return new File([blob], f.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: f.lastModified });
  } catch {
    return f;   // e.g. HEIC on a desktop browser: upload the original
  }
}

export interface Fix { lat: number; lng: number }

/** One GPS reading, or null if the phone says no or takes longer than a few seconds. Never throws. */
export function whereAmI(timeoutMs = 6000): Promise<Fix | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((res) => {
    const t = setTimeout(() => res(null), timeoutMs + 500);
    navigator.geolocation.getCurrentPosition(
      (p) => { clearTimeout(t); res({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6) }); },
      () => { clearTimeout(t); res(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

/** The step a new photo most likely belongs to: the one in progress, else the next one to start, else the last done. */
export function likelyStep<T extends { status: string; start_date: string; sort: number }>(tasks: T[]): T | undefined {
  const by = [...tasks].sort((a, b) => a.sort - b.sort || a.start_date.localeCompare(b.start_date));
  return by.find((t) => t.status === 'in_progress') ?? by.find((t) => t.status === 'todo') ?? by.reverse().find((t) => t.status === 'done');
}

export const mapLink = (lat: number, lng: number) => `https://maps.google.com/?q=${lat},${lng}`;
