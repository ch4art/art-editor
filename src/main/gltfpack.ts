// Runs gltfpack (wasm) in the MAIN process to crush big scenes that are too
// large to load in the renderer (browser memory). Geometry only: meshopt
// compression (-cc) + optional simplify/decimate (-si). Textures are left as-is
// (gltfpack can only touch them via KTX2, which the site viewer doesn't yet
// support). Handles GB-scale inputs that the in-browser optimizer can't.
import { pack } from 'gltfpack';
import { readFileSync, writeFileSync, statSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function gltfpackOptimize(
  inputPath: string,
  simplifyRatio: number,
): Promise<{ bytes: Buffer; before: number; after: number }> {
  const before = statSync(inputPath).size;
  const outPath = join(tmpdir(), `cuteeditor-${process.pid}-${Date.now()}.glb`);

  const args = ['-i', inputPath, '-o', outPath, '-cc'];
  if (simplifyRatio < 0.999) args.push('-si', String(simplifyRatio));

  const iface = {
    read: (p: string) => readFileSync(p),
    write: (p: string, d: Uint8Array) => writeFileSync(p, d),
  };

  await pack(args, iface);

  const bytes = readFileSync(outPath);
  try {
    if (existsSync(outPath)) unlinkSync(outPath);
  } catch {
    /* ignore temp cleanup errors */
  }
  return { bytes, before, after: bytes.length };
}
