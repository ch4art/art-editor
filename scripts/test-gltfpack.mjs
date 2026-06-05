// Verifies the gltfpack wasm API works the same way the Electron main process
// calls it. Usage: node scripts/test-gltfpack.mjs <in.glb> <out.glb> [ratio]
import { pack } from 'gltfpack';
import { readFileSync, writeFileSync, statSync } from 'node:fs';

const input = process.argv[2];
const output = process.argv[3] ?? `${input}.out.glb`;
const ratio = Number(process.argv[4] ?? 0.3);

const before = statSync(input).size;
const iface = {
  read: (p) => readFileSync(p),
  write: (p, d) => writeFileSync(p, d),
};

const args = ['-i', input, '-o', output, '-cc'];
if (ratio < 0.999) args.push('-si', String(ratio));

const log = await pack(args, iface);
process.stdout.write(log);
const after = statSync(output).size;
console.log(
  `\n✅ gltfpack OK: ${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(2)} MB`,
);
