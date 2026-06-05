import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

// gl.readPixels returns rows bottom-to-top; GIF wants top-to-bottom.
function flipY(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length);
  const rowBytes = w * 4;
  for (let y = 0; y < h; y++) {
    out.set(src.subarray(y * rowBytes, y * rowBytes + rowBytes), (h - 1 - y) * rowBytes);
  }
  return out;
}

export type ThumbOptions = { size?: number; frames?: number; bg?: string; delayMs?: number };

/**
 * Renders a .glb spinning a full turn and encodes it to an animated GIF.
 * Mirrors the site's viewer: model centered + normalized + head-on camera.
 */
export async function generateThumbnailGif(
  glb: ArrayBuffer,
  opts: ThumbOptions = {},
): Promise<Uint8Array> {
  const size = opts.size ?? 260;
  const frames = opts.frames ?? 60;
  const bg = opts.bg ?? '#FFF0F6';
  const delay = opts.delayMs ?? 100; // 60 frames @ 100ms ≈ 6s/turn (slow & smooth)

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(size, size, false);
  renderer.setClearColor(new THREE.Color(bg), 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // Match the website's R3F look so colours don't blow out to white.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();

  // Procedural studio environment (no external files) → balanced PBR lighting,
  // just like the site's <Environment>. This is what keeps colours true.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  pmrem.dispose();

  // A gentle key light for a little directional shape.
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(3, 5, 4);
  scene.add(key);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  camera.position.set(0, 0, 1.9);
  camera.lookAt(0, 0, 0);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder); // so gltfpack (-cc) meshopt models load
  const gltf = await loader.parseAsync(glb, '');
  const model = gltf.scene;

  // Normalize: scale longest side to ~1 unit and center at the origin.
  const box = new THREE.Box3().setFromObject(model);
  const sizeV = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(sizeV.x, sizeV.y, sizeV.z) || 1;
  const s = 1 / maxDim;
  model.scale.setScalar(s);
  model.position.set(-center.x * s, -center.y * s, -center.z * s);

  const pivot = new THREE.Group();
  pivot.add(model);
  scene.add(pivot);

  const gif = GIFEncoder();
  const gl = renderer.getContext();
  const pixels = new Uint8Array(size * size * 4);

  for (let i = 0; i < frames; i++) {
    pivot.rotation.y = (i / frames) * Math.PI * 2;
    renderer.render(scene, camera);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const rgba = flipY(pixels, size, size);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, size, size, { palette, delay });
  }

  gif.finish();
  renderer.dispose();
  return gif.bytes();
}
