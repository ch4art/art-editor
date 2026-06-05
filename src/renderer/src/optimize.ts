import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { weld, simplify, meshopt } from '@gltf-transform/functions';

const MAX = 1024; // longest texture side after optimization

export type OptimizeResult = { bytes: Uint8Array; before: number; after: number };
export type OptimizeOptions = { simplifyRatio?: number }; // fraction of triangles to KEEP (1 = none)

/**
 * Auto-optimizes a .glb on upload:
 *   • textures  → resize ≤1024 + JPEG for opaque colour maps   (always, ~lossless)
 *   • geometry  → meshopt compression                           (always, ~lossless)
 *   • geometry  → optional simplify/decimate (lossy)            (only if simplifyRatio < 1)
 * Reads meshopt inputs too (so a gltfpack'd file can be re-optimized). Every
 * stage is best-effort: any failure falls back to the original bytes.
 */
export async function optimizeGlb(
  buf: ArrayBuffer,
  opts: OptimizeOptions = {},
): Promise<OptimizeResult> {
  const before = buf.byteLength;
  const ratio = opts.simplifyRatio ?? 1;
  try {
    await MeshoptDecoder.ready;
    await MeshoptEncoder.ready;
    const io = new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.decoder': MeshoptDecoder,
      'meshopt.encoder': MeshoptEncoder,
    });
    const doc = await io.readBinary(new Uint8Array(buf));

    // 1. Textures.
    const colorTextures = new Set<unknown>();
    for (const mat of doc.getRoot().listMaterials()) {
      const b = mat.getBaseColorTexture();
      if (b) colorTextures.add(b);
      const e = mat.getEmissiveTexture();
      if (e) colorTextures.add(e);
    }
    for (const tex of doc.getRoot().listTextures()) {
      const image = tex.getImage();
      if (!image) continue;
      const recoded = await recodeImage(image, tex.getMimeType(), MAX, colorTextures.has(tex));
      if (recoded && recoded.bytes.byteLength < image.byteLength) {
        tex.setImage(recoded.bytes).setMimeType(recoded.mime);
      }
    }

    // 2. Geometry (best-effort: keep textures even if this fails).
    try {
      const steps = [weld()];
      if (ratio < 0.999) {
        await MeshoptSimplifier.ready;
        steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.01 }));
      }
      steps.push(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
      await doc.transform(...steps);
    } catch {
      /* keep texture-only result */
    }

    const out = await io.writeBinary(doc);
    if (out.byteLength < before) return { bytes: out, before, after: out.byteLength };
    return { bytes: new Uint8Array(buf), before, after: before };
  } catch {
    return { bytes: new Uint8Array(buf), before, after: before };
  }
}

async function recodeImage(
  bytes: Uint8Array,
  mime: string,
  max: number,
  colorEligible: boolean,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime || 'image/png' }));
    const longest = Math.max(bmp.width, bmp.height);
    const scale = longest > max ? max / longest : 1;
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      return null;
    }
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const useJpeg = colorEligible && isOpaque(ctx, w, h);
    const type = useJpeg || mime === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await canvas.convertToBlob(type === 'image/jpeg' ? { type, quality: 0.85 } : { type });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: type };
  } catch {
    return null;
  }
}

function isOpaque(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) return false;
    }
    return true;
  } catch {
    return true;
  }
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
