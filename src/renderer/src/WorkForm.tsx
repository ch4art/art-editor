import { useState } from 'react';
import { generateThumbnailGif } from './thumb';
import { optimizeGlb, formatBytes } from './optimize';

const ENVS = [
  'city',
  'sunset',
  'studio',
  'park',
  'dawn',
  'forest',
  'apartment',
  'lobby',
  'night',
  'warehouse',
];

// Files at/above this go through main-process gltfpack (handles GB-scale);
// smaller files use the in-browser optimizer (which also compresses textures).
const BIG_THRESHOLD = 80 * 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

type RunArgs = { big: boolean; path: string; buf: ArrayBuffer | null; ratio: number };

export default function WorkForm() {
  const [filename, setFilename] = useState('');
  const [filePath, setFilePath] = useState('');
  const [isBig, setIsBig] = useState(false);
  const [origBuf, setOrigBuf] = useState<ArrayBuffer | null>(null);
  const [modelBytes, setModelBytes] = useState<Uint8Array | null>(null);
  const [gifBytes, setGifBytes] = useState<Uint8Array | null>(null);
  const [gifUrl, setGifUrl] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [env, setEnv] = useState('city');
  const [tags, setTags] = useState('');
  const [simplify, setSimplify] = useState(1);
  const [phase, setPhase] = useState<'idle' | 'thumbing' | 'reopt' | 'publishing' | 'done' | 'error'>(
    'idle',
  );
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sizeInfo, setSizeInfo] = useState<{ before: number; after: number } | null>(null);

  async function runOptimize(args: RunArgs): Promise<Uint8Array> {
    if (args.big) {
      const r = await window.api.optimizeBigModel(args.path, { simplifyRatio: args.ratio });
      const bytes = fromBase64(r.base64);
      setModelBytes(bytes);
      setSizeInfo({ before: r.before, after: r.after });
      return bytes;
    }
    const opt = await optimizeGlb(args.buf as ArrayBuffer, { simplifyRatio: args.ratio });
    setModelBytes(opt.bytes);
    setSizeInfo({ before: opt.before, after: opt.after });
    return opt.bytes;
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setFilename(f.name);
    setGifUrl(null);
    setGifBytes(null);
    setSizeInfo(null);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));

    const path = window.api.getPathForFile(f);
    const big = f.size >= BIG_THRESHOLD;
    const buf = big ? null : await f.arrayBuffer();
    setFilePath(path);
    setIsBig(big);
    setOrigBuf(buf);
    setPhase('thumbing');
    try {
      const bytes = await runOptimize({ big, path, buf, ratio: simplify });
      const gif = await generateThumbnailGif(new Uint8Array(bytes).buffer);
      setGifBytes(gif);
      setGifUrl(URL.createObjectURL(new Blob([gif], { type: 'image/gif' })));
      setPhase('idle');
    } catch {
      setError('讀取或壓縮模型失敗,請確認是 .glb 檔。');
      setPhase('error');
    }
  }

  async function onSimplifyChange(ratio: number) {
    setSimplify(ratio);
    if (!filePath) return;
    setPhase('reopt');
    try {
      await runOptimize({ big: isBig, path: filePath, buf: origBuf, ratio });
    } catch {
      setError('重新壓縮失敗');
    }
    setPhase('idle');
  }

  async function publish() {
    if (!modelBytes || !gifBytes) {
      setError('請先選一個 .glb 模型');
      return;
    }
    if (!title.trim()) {
      setError('請填作品名稱');
      return;
    }
    setError(null);
    setPhase('publishing');
    try {
      const tagList = tags
        .split(/[,，、\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await window.api.publish.work({
        title: title.trim(),
        description: desc.trim(),
        environment: env,
        tags: tagList,
        body: '',
        modelFilename: filename,
        modelBase64: toBase64(modelBytes),
        gifBase64: toBase64(gifBytes),
      });
      setResult(res);
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : '發布失敗');
      setPhase('error');
    }
  }

  function reset() {
    setFilename('');
    setFilePath('');
    setIsBig(false);
    setOrigBuf(null);
    setModelBytes(null);
    setGifBytes(null);
    setGifUrl(null);
    setTitle('');
    setDesc('');
    setEnv('city');
    setTags('');
    setSimplify(1);
    setPhase('idle');
    setResult(null);
    setError(null);
    setSizeInfo(null);
  }

  if (phase === 'done' && result) {
    return (
      <div className="form">
        <div className="card center">
          <h1>🎉 作品發布成功!</h1>
          <p>已加到作品集,網站大約 1–2 分鐘後會自動更新。</p>
          <div className="btnrow">
            <button className="btn" onClick={() => window.api.openExternal(result.url)}>
              看作品
            </button>
            <button className="btn ghost" onClick={reset}>
              再加一個
            </button>
          </div>
        </div>
      </div>
    );
  }

  const busy = phase === 'thumbing' || phase === 'reopt';

  return (
    <main className="form">
      <h2>加一個 3D 作品 🎨</h2>

      <label className="filepick">
        選擇模型檔(.glb)
        <input type="file" accept=".glb,model/gltf-binary" onChange={onFile} />
      </label>

      {phase === 'thumbing' && (
        <p className="waiting">
          {isBig
            ? '⏳ 大型檔案,改用 gltfpack 在背景壓縮中…(可能要幾秒~幾十秒)'
            : '⏳ 正在自動壓縮(幾何 + 貼圖)+ 產生旋轉縮圖…'}
        </p>
      )}
      {phase === 'reopt' && <p className="waiting">⏳ 重新壓縮中…</p>}

      {gifUrl && (
        <div className="thumbprev">
          <img src={gifUrl} alt="縮圖預覽" width={220} height={220} />
          <p className="hint">↑ 作品集會顯示的旋轉縮圖</p>
        </div>
      )}

      {sizeInfo && !busy && (
        <p className="hint">
          {sizeInfo.after < sizeInfo.before
            ? `已自動壓縮:${formatBytes(sizeInfo.before)} → ${formatBytes(sizeInfo.after)} ✅`
            : `大小:${formatBytes(sizeInfo.after)}(已很精簡)`}
          {isBig && '(大檔走 gltfpack,只壓幾何;貼圖請先在 Blender 處理)'}
        </p>
      )}

      {filePath && (
        <label>
          減面(大型場景才需要,會降細節)
          <select
            value={simplify}
            onChange={(e) => onSimplifyChange(Number(e.target.value))}
            disabled={busy}
          >
            <option value={1}>保留全部細節(預設)</option>
            <option value={0.7}>中度減面(保留約 70%)</option>
            <option value={0.4}>大幅減面(保留約 40%)</option>
            <option value={0.2}>極限減面(保留約 20%)</option>
            <option value={0.1}>超極限減面(保留約 10%)</option>
          </select>
        </label>
      )}

      <label>
        作品名稱
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如:我的貓咪" />
      </label>

      <label>
        一句話介紹
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="會顯示在作品頁(可留空)" />
      </label>

      <div className="row">
        <label>
          燈光氣氛
          <select value={env} onChange={(e) => setEnv(e.target.value)}>
            {ENVS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label>
          標籤
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用逗號分隔" />
        </label>
      </div>

      {error && <p className="error">⚠️ {error}</p>}

      <button
        className="btn publish"
        onClick={publish}
        disabled={busy || phase === 'publishing' || !gifBytes}
      >
        {phase === 'publishing' ? '發布中…請稍候' : '🚀 發布作品'}
      </button>
    </main>
  );
}
