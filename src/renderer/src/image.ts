// Compresses an image for the blog: resize to ≤1600px on the longest side and
// re-encode (opaque → JPEG q0.85, transparent → PNG). Animated GIFs are kept
// as-is (re-encoding would freeze them). Falls back to the original bytes if
// they're already smaller.

const MAX = 1600;

export type CompressedImage = { bytes: Uint8Array; ext: string };

export async function compressImage(file: File): Promise<CompressedImage> {
  const orig = new Uint8Array(await file.arrayBuffer());
  const origExt = (file.name.split('.').pop() || 'png').toLowerCase();

  // Keep animated GIFs untouched.
  if (file.type === 'image/gif' || origExt === 'gif') {
    return { bytes: orig, ext: 'gif' };
  }

  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      return { bytes: orig, ext: origExt };
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();

    const data = ctx.getImageData(0, 0, w, h).data;
    let opaque = true;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) {
        opaque = false;
        break;
      }
    }

    const type = opaque ? 'image/jpeg' : 'image/png';
    const blob = await canvas.convertToBlob(opaque ? { type, quality: 0.85 } : { type });
    const bytes = new Uint8Array(await blob.arrayBuffer());

    if (orig.byteLength <= bytes.byteLength) return { bytes: orig, ext: origExt };
    return { bytes, ext: opaque ? 'jpg' : 'png' };
  } catch {
    return { bytes: orig, ext: origExt };
  }
}

export function imageMime(ext: string): string {
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/png';
}
