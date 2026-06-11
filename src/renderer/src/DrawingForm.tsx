// 上傳 2D 畫作:選圖 → 取名 → 發布,三步完成。
// 圖片自動壓縮(≤1600px,跟文章圖片同一條管線);網站端會再做
// 響應式縮圖,這裡不用想任何技術細節。
import { useEffect, useState } from 'react';
import { compressImage, imageMime } from './image';

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

/** Prefilled values when editing a published drawing (from the manage tab). */
export type EditDrawing = {
  slug: string;
  title: string;
  alt: string;
  desc: string;
  tags: string; // comma-joined
  featured: boolean;
  date: string;
  imageFile: string;
  imageUrl: string | null; // existing image, for display
};

export default function DrawingForm({
  edit,
  onDone,
}: {
  edit?: EditDrawing;
  onDone?: () => void;
}) {
  const [imgBytes, setImgBytes] = useState<Uint8Array | null>(null);
  const [imgExt, setImgExt] = useState('');
  const [imgUrl, setImgUrl] = useState<string | null>(edit?.imageUrl ?? null);
  const [title, setTitle] = useState(edit?.title ?? '');
  const [alt, setAlt] = useState(edit?.alt ?? '');
  const [desc, setDesc] = useState(edit?.desc ?? '');
  const [tags, setTags] = useState(edit?.tags ?? '');
  const [featured, setFeatured] = useState(edit?.featured ?? false);
  const [phase, setPhase] = useState<
    'idle' | 'reading' | 'publishing' | 'deploying' | 'done' | 'error'
  >('idle');
  const [doneNote, setDoneNote] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitSec, setWaitSec] = useState(0);

  // 等部署時數秒,讓等待有感覺
  useEffect(() => {
    if (phase !== 'deploying') return;
    setWaitSec(0);
    const t = setInterval(() => setWaitSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setError(null);
    setPhase('reading');
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''));
    try {
      const { bytes, ext } = await compressImage(f);
      setImgBytes(bytes);
      setImgExt(ext);
      setImgUrl(
        URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: imageMime(ext) })),
      );
      setPhase('idle');
    } catch {
      setError('讀取圖片失敗,請換一張試試(支援 jpg / png / gif / webp)。');
      setPhase('error');
    }
  }

  async function publish() {
    const hasNewImage = Boolean(imgBytes);
    if (!edit && !hasNewImage) {
      setError('請先選一張圖');
      return;
    }
    if (!title.trim()) {
      setError('請幫這張畫取個名字');
      return;
    }
    setError(null);
    setPhase('publishing');
    try {
      const tagList = tags
        .split(/[,，、\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await window.api.publish.drawing({
        title: title.trim(),
        alt: alt.trim(),
        description: desc.trim(),
        tags: tagList,
        featured,
        ...(hasNewImage ? { imageBase64: toBase64(imgBytes!), imageExt: imgExt } : {}),
        ...(edit
          ? { existingSlug: edit.slug, existingImage: edit.imageFile, date: edit.date }
          : {}),
      });
      setResult(res);
      // 等網站真的部署完成,「看畫」按下去保證是新的。
      setPhase('deploying');
      let live = { ok: true, state: 'skipped' };
      try {
        if (typeof window.api.publish.waitLive === 'function') {
          live = await window.api.publish.waitLive(res.sha);
        }
      } catch {
        live = { ok: false, state: 'error' };
      }
      setDoneNote(
        live.ok ? null : '網站這次更新得比平常慢,如果點開還沒看到,等一下再重新整理就好。',
      );
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : '發布失敗');
      setPhase('error');
    }
  }

  function reset() {
    setImgBytes(null);
    setImgExt('');
    setImgUrl(null);
    setTitle('');
    setAlt('');
    setDesc('');
    setTags('');
    setFeatured(false);
    setPhase('idle');
    setDoneNote(null);
    setResult(null);
    setError(null);
  }

  if (phase === 'done' && result) {
    return (
      <div className="form">
        <div className="card center">
          <h1>{edit ? '✨ 畫作更新完成!' : '🎉 畫貼上牆了!'}</h1>
          <p>{doneNote ?? '網站已經更新好,點下面就能看到!'}</p>
          <div className="btnrow">
            <button className="btn" onClick={() => window.api.openExternal(result.url)}>
              看畫
            </button>
            {edit && onDone ? (
              <button className="btn ghost" onClick={onDone}>
                回管理列表
              </button>
            ) : (
              <button className="btn ghost" onClick={reset}>
                再貼一張
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="form">
      <h2>{edit ? '編輯畫作 ✏️' : '貼一張畫上牆 🖍️'}</h2>
      {edit && (
        <p className="hint">
          正在編輯已發布的畫作,按「儲存修改」會直接覆蓋網站上的版本。
          {onDone && (
            <button className="link" style={{ marginLeft: 8 }} onClick={onDone}>
              ↩️ 取消,回列表
            </button>
          )}
        </p>
      )}

      <label className="filepick">
        {edit ? '換一張圖(不換就維持原本的)' : '選擇圖片(jpg / png / gif / webp)'}
        <input type="file" accept="image/*" onChange={onFile} />
      </label>

      {phase === 'reading' && <p className="waiting">⏳ 正在讀取並壓縮圖片…</p>}

      {imgUrl && (
        <div className="thumbprev">
          <img
            src={imgUrl}
            alt="圖片預覽"
            style={{ maxWidth: 280, maxHeight: 280, width: 'auto', height: 'auto' }}
          />
          <p className="hint">{edit && !imgBytes ? '↑ 目前網站上的圖' : '↑ 會貼上牆的圖'}</p>
        </div>
      )}

      <label>
        畫的名字
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="例如:午睡的貓"
        />
      </label>

      <label>
        一句話介紹
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder="點開大圖時顯示(可留空)"
        />
      </label>

      <div className="row">
        <label>
          標籤
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用逗號分隔,變成牆上的篩選按鈕" />
        </label>
        <label>
          圖片描述(給看不到圖的朋友)
          <input
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            placeholder="留空就用畫的名字"
          />
        </label>
      </div>

      <label className="prilabel">
        <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
        &nbsp;⭐ 設為精選(首頁的「畫畫的」門會優先展示)
      </label>

      {error && <p className="error">⚠️ {error}</p>}

      <button
        className="btn publish"
        onClick={publish}
        disabled={
          phase === 'reading' ||
          phase === 'publishing' ||
          phase === 'deploying' ||
          (!edit && !imgBytes)
        }
      >
        {phase === 'publishing' ? (
          <>
            <span className="btn-ring" />
            {edit ? '儲存中…' : '上傳中…'}
          </>
        ) : phase === 'deploying' ? (
          <>
            <span className="btn-ring" />
            🐭 網站更新中…
          </>
        ) : edit ? (
          '💾 儲存修改'
        ) : (
          '🚀 貼上牆!'
        )}
      </button>
      {phase === 'deploying' && (
        <p className="hint">
          上傳完成!網站要整個重新蓋一次,<b>大約 1~2 分鐘</b>~已經等了 {waitSec}{' '}
          秒,好了會直接告訴你!
        </p>
      )}
    </main>
  );
}
