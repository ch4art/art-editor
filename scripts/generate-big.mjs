// Inflates a high-poly model into a GB-scale "scene" by deep-duplicating its
// geometry many times (factory-style: lots of geometry). Run:
//   node --max-old-space-size=6144 scripts/generate-big.mjs <in.glb> <out.glb> <copies>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const inPath = process.argv[2];
const outPath = process.argv[3];
const N = Number(process.argv[4] || 100);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inPath);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const srcMeshes = root.listMeshes();

function deepCloneMesh(mesh) {
  const m = doc.createMesh();
  for (const prim of mesh.listPrimitives()) {
    const p = doc.createPrimitive().setMode(prim.getMode());
    const mat = prim.getMaterial();
    if (mat) p.setMaterial(mat); // share material/textures; only geometry inflates
    const idx = prim.getIndices();
    if (idx) {
      p.setIndices(
        doc.createAccessor().setType(idx.getType()).setArray(idx.getArray().slice()),
      );
    }
    for (const sem of prim.listSemantics()) {
      const a = prim.getAttribute(sem);
      p.setAttribute(
        sem,
        doc
          .createAccessor()
          .setType(a.getType())
          .setNormalized(a.getNormalized())
          .setArray(a.getArray().slice()),
      );
    }
    m.addPrimitive(p);
  }
  return m;
}

const cols = 12;
for (let i = 1; i < N; i++) {
  for (const mesh of srcMeshes) {
    const cloned = deepCloneMesh(mesh);
    const node = doc
      .createNode(`copy_${i}`)
      .setMesh(cloned)
      .setTranslation([(i % cols) * 3, 0, Math.floor(i / cols) * 3]);
    scene.addChild(node);
  }
  if (i % 10 === 0) console.log(`  ...${i}/${N} copies`);
}

await io.write(outPath, doc);
console.log(`Wrote ${outPath} (${N}x copies)`);
