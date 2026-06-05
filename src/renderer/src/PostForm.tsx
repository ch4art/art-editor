import { useEffect, useMemo, useRef, useState } from 'react';
import RichEditor, { type RichEditorHandle } from './RichEditor';
import { optimizeGlb } from './optimize';
import { generateThumbnailGif } from './thumb';
import { compressImage, imageMime } from './image';
import { saveDraft, loadDraft, clearDraft } from './draft';

const DRAFT_KEY = 'post';

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

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

type Attached = { filename: string; bytes: Uint8Array };
type AttachedImage = { filename: string; bytes: Uint8Array; url: string };
type DraftShape = {
  title: string;
  desc: string;
  date: string;
  tags: string;
  body: string;
  models: Attached[];
  images: Attached[];
};

const TOKEN_ALL = /<<3D模型:\s*([^>]+?)\s*>>/g;

function blobUrlFor(img: Attached): string {
  return URL.createObjectURL(
    new Blob([img.bytes as BlobPart], {
      type: imageMime(img.filename.split('.').pop() || 'png'),
    }),
  );
}

/** The title, editable in-place, styled exactly like the published page.
 *  Uncontrolled contentEditable (set once on mount, remounted via key when the
 *  document is replaced) — React never writes during typing, so the caret and
 *  Chinese IME composition are safe. An <input> can't render the site's
 *  stroked/shadowed title style. */
function TitleEdit({ initial, onChange }: { initial: string; onChange: (s: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.textContent = initial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={ref}
      className="pv-title pv-title-edit"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      data-ph="文章標題…"
      onInput={() => onChange((ref.current?.textContent ?? '').replace(/\n+/g, ' '))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.preventDefault(); // 標題只有一行
      }}
      onPaste={(e) => {
        e.preventDefault(); // 貼上時只收純文字
        const text = e.clipboardData.getData('text/plain').replace(/\s+/g, ' ');
        document.execCommand('insertText', false, text);
      }}
    />
  );
}

/** Prefilled values when editing a published post (from the manage tab). */
export type EditPost = {
  path: string; // repo path of the existing .mdx — republish overwrites it
  title: string;
  desc: string;
  date: string;
  tags: string; // comma-joined
  body: string; // ModelViewer JSX already reversed to <<3D模型: …>> tokens
  images: Attached[];
};

export default function PostForm({ edit, onDone }: { edit?: EditPost; onDone?: () => void }) {
  const [title, setTitle] = useState(edit?.title ?? '');
  const [desc, setDesc] = useState(edit?.desc ?? '');
  const [date, setDate] = useState(edit?.date || today());
  const [tags, setTags] = useState(edit?.tags ?? '');
  const [body, setBody] = useState(edit?.body ?? '');
  const [models, setModels] = useState<Attached[]>([]);
  const [images, setImages] = useState<AttachedImage[]>(() =>
    (edit?.images ?? []).map((img) => ({ ...img, url: blobUrlFor(img) })),
  );
  const [modelGifs, setModelGifs] = useState<Record<string, string>>({});
  // The editor is remounted (key=n) whenever the whole document is replaced
  // from outside (draft restore / start-over) — simpler & safer than imperative sync.
  const [seed, setSeed] = useState({ md: edit?.body ?? '', n: 0 });
  const [status, setStatus] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const editorRef = useRef<RichEditorHandle>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);
  const restoreRan = useRef(false); // StrictMode double-mount guard
  // Bumped on 「從頭開始」 so in-flight async GIF loops drop their results.
  const epoch = useRef(0);
  const imgSeq = useRef(1); // unique image filenames within one second

  const tagList = tags
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const assets = useMemo(
    () => ({
      modelGifs,
      imageUrls: Object.fromEntries(images.map((i) => [i.filename, i.url])),
    }),
    [modelGifs, images],
  );

  // Only assets still referenced in the body get uploaded (deleting a block
  // in the editor really removes its file from the publish payload).
  const usedModels = models.filter((m) => body.includes(`<<3D模型: ${m.filename}>>`));
  const usedImages = images.filter((i) => body.includes(`./images/${i.filename}`));

  function setGif(file: string, url: string) {
    setModelGifs((prev) => {
      if (prev[file]) URL.revokeObjectURL(prev[file]);
      return { ...prev, [file]: url };
    });
  }

  // ---------- 草稿:啟動時還原(編輯模式不碰新文章的草稿) ----------
  useEffect(() => {
    if (edit) {
      loaded.current = true;
      return;
    }
    if (restoreRan.current) return;
    restoreRan.current = true;
    const myEpoch = epoch.current;
    (async () => {
      try {
        const d = await loadDraft<DraftShape>(DRAFT_KEY);
        if (d && (d.title || d.body || d.models?.length || d.images?.length)) {
          setTitle(d.title ?? '');
          setDesc(d.desc ?? '');
          setDate(d.date || today());
          setTags(d.tags ?? '');
          setBody(d.body ?? '');
          setSeed((s) => ({ md: d.body ?? '', n: s.n + 1 }));
          setModels(d.models ?? []);
          setImages((d.images ?? []).map((img) => ({ ...img, url: blobUrlFor(img) })));
          setRestored(true);
          loaded.current = true; // autosave may resume right away
          // 背景重建 3D 預覽 GIF(不擋自動儲存)
          for (const m of d.models ?? []) {
            try {
              const gif = await generateThumbnailGif(new Uint8Array(m.bytes).buffer, {
                size: 220,
                frames: 40,
              });
              if (epoch.current !== myEpoch) return; // user pressed 從頭開始
              setGif(m.filename, URL.createObjectURL(new Blob([gif], { type: 'image/gif' })));
            } catch {
              /* 預覽失敗就顯示占位框 */
            }
          }
        }
      } catch {
        /* 草稿讀取失敗就從空白開始 */
      } finally {
        loaded.current = true;
      }
    })();
  }, []);

  // ---------- 編輯模式:抓網站上的模型回來,讓 3D 區塊也有會轉的預覽 ----------
  useEffect(() => {
    if (!edit || restoreRan.current) return;
    restoreRan.current = true;
    const myEpoch = epoch.current;
    const files = [...new Set([...edit.body.matchAll(TOKEN_ALL)].map((m) => m[1].trim()))];
    (async () => {
      for (const file of files) {
        try {
          const b64 = await window.api.content.getBinary(`public/models/${file}`);
          const gif = await generateThumbnailGif(new Uint8Array(fromBase64(b64)).buffer, {
            size: 220,
            frames: 40,
          });
          if (epoch.current !== myEpoch) return;
          setGif(file, URL.createObjectURL(new Blob([gif], { type: 'image/gif' })));
        } catch {
          /* 抓不到就顯示占位框,不影響編輯 */
        }
      }
    })();
  }, []);

  // ---------- 草稿:自動儲存(800ms 防抖;編輯模式不儲存) ----------
  useEffect(() => {
    if (edit || !loaded.current || status === 'done') return;
    const t = setTimeout(() => {
      const d: DraftShape = {
        title,
        desc,
        date,
        tags,
        body,
        models: models.map((m) => ({ filename: m.filename, bytes: m.bytes })),
        images: images.map((i) => ({ filename: i.filename, bytes: i.bytes })),
      };
      saveDraft(DRAFT_KEY, d).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [title, desc, date, tags, body, models, images, status]);

  async function addModel(f: File) {
    setModelBusy(true);
    const myEpoch = epoch.current;
    try {
      const opt = await optimizeGlb(await f.arrayBuffer());
      if (epoch.current !== myEpoch) return;
      setModels((prev) => [
        ...prev.filter((m) => m.filename !== f.name),
        { filename: f.name, bytes: opt.bytes },
      ]);
      editorRef.current?.insertModel(f.name);
      try {
        const gif = await generateThumbnailGif(new Uint8Array(opt.bytes).buffer, {
          size: 220,
          frames: 40,
        });
        if (epoch.current !== myEpoch) return;
        setGif(f.name, URL.createObjectURL(new Blob([gif], { type: 'image/gif' })));
      } catch {
        /* 預覽 GIF 失敗就顯示占位框 */
      }
    } finally {
      setModelBusy(false);
    }
  }

  async function onModelFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    await addModel(f);
  }

  async function addImages(files: File[]) {
    setImgBusy(true);
    const myEpoch = epoch.current;
    try {
      for (const f of files) {
        const { bytes, ext } = await compressImage(f);
        if (epoch.current !== myEpoch) return;
        const name = `img-${stamp()}-${imgSeq.current++}.${ext}`;
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMime(ext) }));
        setImages((prev) => [...prev, { filename: name, bytes, url }]);
        editorRef.current?.insertImage(`./images/${name}`);
      }
    } finally {
      setImgBusy(false);
    }
  }

  async function onImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length) await addImages(files);
  }

  async function publish() {
    if (!title.trim()) {
      setError('標題不能空白喔');
      return;
    }
    setError(null);
    setStatus('publishing');
    try {
      const res = await window.api.publish.post({
        title: title.trim(),
        description: desc.trim(),
        date,
        tags: tagList,
        body,
        models: usedModels.map((m) => ({ filename: m.filename, base64: toBase64(m.bytes) })),
        images: usedImages.map((i) => ({ filename: i.filename, base64: toBase64(i.bytes) })),
        existingPath: edit?.path,
      });
      setResult(res);
      setStatus('done');
      if (!edit) clearDraft(DRAFT_KEY).catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : '發布失敗');
      setStatus('error');
    }
  }

  function newPost() {
    epoch.current++; // cancel in-flight GIF loops
    for (const i of images) URL.revokeObjectURL(i.url);
    for (const url of Object.values(modelGifs)) URL.revokeObjectURL(url);
    setTitle('');
    setDesc('');
    setDate(today());
    setTags('');
    setBody('');
    setSeed((s) => ({ md: '', n: s.n + 1 }));
    setModels([]);
    setImages([]);
    setModelGifs({});
    setStatus('idle');
    setResult(null);
    setError(null);
    setRestored(false);
    clearDraft(DRAFT_KEY).catch(() => {});
  }

  if (status === 'done' && result) {
    return (
      <div className="form">
        <div className="card center">
          <h1>{edit ? '✨ 更新成功!' : '🎉 發布成功!'}</h1>
          <p>{edit ? '修改已送出' : '文章已經送出'},網站大約 1–2 分鐘後會自動更新。</p>
          <div className="btnrow">
            <button className="btn" onClick={() => window.api.openExternal(result.url)}>
              看文章
            </button>
            {edit && onDone ? (
              <button className="btn ghost" onClick={onDone}>
                回管理列表
              </button>
            ) : (
              <button className="btn ghost" onClick={newPost}>
                再寫一篇
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="form formwide">
      <h2>{edit ? `編輯文章 ✏️` : '寫一篇新文章 ✏️'}</h2>
      {edit && (
        <p className="hint">
          正在編輯已發布的文章,按「儲存修改」會直接覆蓋網站上的版本。
          {onDone && (
            <button className="link" style={{ marginLeft: 8 }} onClick={onDone}>
              ↩️ 取消,回列表
            </button>
          )}
        </p>
      )}

      {restored && (
        <p className="hint">
          📝 已還原上次沒寫完的草稿
          <button className="link" style={{ marginLeft: 8 }} onClick={newPost}>
            🗑️ 不要了,從頭開始
          </button>
        </p>
      )}

      <label>
        一句話介紹
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="會顯示在文章列表(可留空)" />
      </label>

      <div className="row">
        <label>
          日期
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label>
          標籤
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用逗號分隔,如:日常, 貓咪" />
        </label>
      </div>

      <label className="bodylabel">文章(下面就是發布後的樣子,直接打字 ✨)</label>
      <RichEditor
        key={seed.n}
        ref={editorRef}
        initialMarkdown={seed.md}
        assets={assets}
        onMarkdownChange={setBody}
        onAddImages={addImages}
        onDropModel={addModel}
        header={
          <div className="pv-head">
            <TitleEdit key={`t${seed.n}`} initial={title} onChange={setTitle} />
            <div className="pv-date">{date.split('-').join('/')}</div>
            {tagList.length > 0 && (
              <div className="pv-tags">
                {tagList.map((t) => (
                  <span key={t}>#{t}</span>
                ))}
              </div>
            )}
          </div>
        }
        extraButtons={
          <>
            <button
              type="button"
              className="tb-img"
              onClick={() => imgRef.current?.click()}
              disabled={imgBusy}
            >
              {imgBusy ? '⏳ 處理圖片中…' : '🖼️ 插入圖片'}
            </button>
            <button
              type="button"
              className="tb-3d"
              onClick={() => fileRef.current?.click()}
              disabled={modelBusy}
            >
              {modelBusy ? '⏳ 處理模型中…' : '🧊 插入 3D 模型'}
            </button>
          </>
        }
      />
      <input
        ref={imgRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: 'none' }}
        onChange={onImageFile}
      />
      <input
        ref={fileRef}
        type="file"
        accept=".glb,model/gltf-binary"
        style={{ display: 'none' }}
        onChange={onModelFile}
      />
      {(usedModels.length > 0 || usedImages.length > 0) && (
        <p className="hint">
          會一起上傳:
          {usedImages.length > 0 && ` 🖼️ ${usedImages.length} 張圖片`}
          {usedModels.length > 0 && ` 🧊 ${usedModels.length} 個 3D 模型`}
        </p>
      )}

      {error && <p className="error">⚠️ {error}</p>}

      <button className="btn publish" onClick={publish} disabled={status === 'publishing'}>
        {status === 'publishing' ? (edit ? '儲存中…請稍候' : '發布中…請稍候') : edit ? '💾 儲存修改' : '🚀 發布'}
      </button>
    </main>
  );
}
