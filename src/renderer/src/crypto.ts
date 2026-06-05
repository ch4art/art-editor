// 私密文章加密:密語 → PBKDF2-SHA256(310,000 輪)→ AES-GCM 256。
// 密語不會儲存在任何地方;網站和 GitHub 上只有密文。
// 格式與網站端 blog/[...id].astro 的解鎖腳本一一對應。
import { imageMime } from './image';

const ITER = 310000;

// 密語正規化:NFC + 去頭尾空白,跟網站端 [...id].astro 一致(避免中文/emoji
// 在不同裝置正規化不同、或多打一個空白就永遠解不開)。
export const normPw = (s: string): string => s.normalize('NFC').trim();

const b64 = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
};

const b64d = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(
  pw: string,
  salt: Uint8Array,
  usages: KeyUsage[],
  iter = ITER,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(normPw(pw)),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: iter, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  );
}

export type PrivateImageRef = { name: string; file: string; iv: string; type: string };
export type PrivatePayload = { md: string; images: PrivateImageRef[] };

/** Encrypt a post body + its images. Returns the frontmatter `cipher` string
 *  and the encrypted image files to commit. */
export async function encryptPrivate(
  pw: string,
  md: string,
  images: { filename: string; bytes: Uint8Array }[],
): Promise<{ cipher: string; encImages: { path: string; base64: string }[] }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pw, salt, ['encrypt']);

  const refs: PrivateImageRef[] = [];
  const encImages: { path: string; base64: string }[] = [];
  for (const img of images) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      img.bytes as BufferSource,
    );
    const file = `private/${img.filename}.bin`;
    encImages.push({ path: `public/${file}`, base64: b64(ct) });
    refs.push({
      name: img.filename,
      file,
      iv: b64(iv),
      type: imageMime(img.filename.split('.').pop() || 'png'),
    });
  }

  const payload: PrivatePayload = { md, images: refs };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const envelope = { v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  return { cipher: btoa(JSON.stringify(envelope)), encImages };
}

/** Open an existing private post for editing. Throws on a wrong password. */
export async function openPrivate(
  pw: string,
  cipher: string,
): Promise<{ payload: PrivatePayload; key: CryptoKey }> {
  const env = JSON.parse(atob(cipher));
  const salt = b64d(env.salt);
  const key = await deriveKey(pw, salt, ['decrypt', 'encrypt'], env.iter || ITER);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64d(env.iv) as BufferSource },
    key,
    b64d(env.ct) as BufferSource,
  );
  return { payload: JSON.parse(new TextDecoder().decode(pt)) as PrivatePayload, key };
}

/** Decrypt one image file fetched from the repo (for edit mode). */
export async function decryptImage(
  key: CryptoKey,
  ivB64: string,
  ctBytes: Uint8Array,
): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64d(ivB64) as BufferSource },
    key,
    ctBytes as BufferSource,
  );
  return new Uint8Array(pt);
}
