import { useEffect, useRef, useState } from 'react';
import { marked } from 'marked';
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

type Attached = { filename: string; bytes: Uint8Array };
type AttachedImage = { filename: string; bytes: Uint8Array; url: string };

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
type DraftShape = {
  title: string;
  desc: string;
  date: string;
  tags: string;
  body: string;
  models: Attached[];
  images: Attached[];
};

const TOKEN_SPLIT = /(<<3D模型:\s*[^>]+?>>)/g;
const TOKEN_MATCH = /<<3D模型:\s*([^>]+?)\s*>>/;

function Preview({
  title,
  date,
  tags,
  body,
  modelGifs,
  images,
}: {
  title: string;
  date: string;
  tags: string[];
  body: string;
  modelGifs: Record<string, string>;
  images: AttachedImage[];
}) {
  const parts = body.split(TOKEN_SPLIT);
  return (
    <div className="preview-pane">
      <div className="pv-label">👀 即時預覽(發布後長這樣)</div>
      <div>
        <span className="pv-title">{title || '(文章標題)'}</span>
      </div>
      <div className="pv-date">{date.replaceAll('-', '/')}</div>
      {tags.length > 0 && (
        <div className="pv-tags">
          {tags.map((t) => (
            <span key={t}>#{t}</span>
          ))}
        </div>
      )}
      <div className="pv-body">
        {parts.map((part, i) => {
          const m = part.match(TOKEN_MATCH);
          if (m) {
            const file = m[1].trim();
            const gif = modelGifs[file];
            return gif ? (
              <div key={i} className="pv-model">
                <img src={gif} alt={file} width={220} height={220} />
                <span>🧊 3D 模型(在網站上可以旋轉、縮放)</span>
              </div>
            ) : (
              <div key={i} className="pv-model pv-model-empty">
                🧊 3D 模型:{file}
              </div>
            );
          }
          if (!part.trim()) return null;
          let html = marked.parse(part) as string;
          for (const img of images) {
            html = html.split(`./images/${img.filename}`).join(img.url);
          }
          return <div key={i} dangerouslySetInnerHTML={{ __html: html }} />;
        })}
        {!body.trim() && <p style={{ opacity: 0.45 }}>(開始打字,右邊就會即時顯示…)</p>}
      </div>
    </div>
  );
}

export default function PostForm({ edit, onDone }: { edit?: EditPost; onDone?: () => void }) {
  const [title, setTitle] = useState(edit?.title ?? '');
  const [desc, setDesc] = useState(edit?.desc ?? '');
  const [date, setDate] = useState(edit?.date || today());
  const [tags, setTags] = useState(edit?.tags ?? '');
  const [body, setBody] = useState(edit?.body ?? '');
  const [models, setModels] = useState<Attached[]>([]);
  const [images, setImages] = useState<AttachedImage[]>(() =>
    (edit?.images ?? []).map((img) => ({
      ...img,
      url: URL.createObjectURL(
        new Blob([img.bytes as BlobPart], {
          type: imageMime(img.filename.split('.').pop() || 'png'),
        }),
      ),
    })),
  );
  const [modelGifs, setModelGifs] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);

  const tagList = tags
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  // ---------- 草稿:啟動時還原(編輯模式不碰新文章的草稿) ----------
  useEffect(() => {
    if (edit) {
      loaded.current = true;
      return;
    }
    (async () => {
      try {
        const d = await loadDraft<DraftShape>(DRAFT_KEY);
        if (d && (d.title || d.body || d.models?.length || d.images?.length)) {
          setTitle(d.title ?? '');
          setDesc(d.desc ?? '');
          setDate(d.date || today());
          setTags(d.tags ?? '');
          setBody(d.body ?? '');
          setModels(d.models ?? []);
          setImages(
            (d.images ?? []).map((img) => ({
              ...img,
              url: URL.createObjectURL(
                new Blob([img.bytes as BlobPart], {
                  type: imageMime(img.filename.split('.').pop() || 'png'),
                }),
              ),
            })),
          );
          setRestored(true);
          // 背景重建 3D 預覽 GIF
          for (const m of d.models ?? []) {
            try {
              const gif = await generateThumbnailGif(new Uint8Array(m.bytes).buffer, {
                size: 220,
                frames: 40,
              });
              const url = URL.createObjectURL(new Blob([gif], { type: 'image/gif' }));
              setModelGifs((prev) => ({ ...prev, [m.filename]: url }));
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

  function wrap(before: string, after = before) {
    const ta = bodyRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const e = ta.selectionEnd;
    const sel = body.slice(s, e) || '文字';
    setBody(body.slice(0, s) + before + sel + after + body.slice(e));
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = s + before.length;
      ta.selectionEnd = s + before.length + sel.length;
    });
  }

  function prefixLine(prefix: string) {
    const ta = bodyRef.current;
    if (!ta) return;
    const s = ta.selectionStart;
    const lineStart = body.lastIndexOf('\n', s - 1) + 1;
    setBody(body.slice(0, lineStart) + prefix + body.slice(lineStart));
    requestAnimationFrame(() => ta.focus());
  }

  function insertAtCursor(text: string) {
    const ta = bodyRef.current;
    if (!ta) {
      setBody(body + text);
      return;
    }
    const s = ta.selectionStart;
    setBody(body.slice(0, s) + text + body.slice(s));
    requestAnimationFrame(() => ta.focus());
  }

  async function onModelFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setModelBusy(true);
    try {
      const opt = await optimizeGlb(await f.arrayBuffer());
      setModels((prev) => [
        ...prev.filter((m) => m.filename !== f.name),
        { filename: f.name, bytes: opt.bytes },
      ]);
      try {
        const gif = await generateThumbnailGif(new Uint8Array(opt.bytes).buffer, {
          size: 220,
          frames: 40,
        });
        const url = URL.createObjectURL(new Blob([gif], { type: 'image/gif' }));
        setModelGifs((prev) => ({ ...prev, [f.name]: url }));
      } catch {
        /* 預覽 GIF 失敗就顯示占位框 */
      }
      insertAtCursor(`\n<<3D模型: ${f.name}>>\n`);
    } finally {
      setModelBusy(false);
    }
  }

  async function onImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setImgBusy(true);
    try {
      const { bytes, ext } = await compressImage(f);
      const name = `img-${stamp()}.${ext}`;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageMime(ext) }));
      setImages((prev) => [...prev, { filename: name, bytes, url }]);
      insertAtCursor(`\n![圖片](./images/${name})\n`);
    } finally {
      setImgBusy(false);
    }
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
        models: models.map((m) => ({ filename: m.filename, base64: toBase64(m.bytes) })),
        images: images.map((i) => ({ filename: i.filename, base64: toBase64(i.bytes) })),
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
    setTitle('');
    setDesc('');
    setDate(today());
    setTags('');
    setBody('');
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
    <div className="postwrap">
      <main className="form">
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
          標題
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如:我做了一隻貓" />
        </label>

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

        <label className="bodylabel">內文</label>
        <div className="toolbar">
          <button type="button" onClick={() => wrap('**')}>
            粗體
          </button>
          <button type="button" onClick={() => wrap('*')}>
            斜體
          </button>
          <button type="button" onClick={() => prefixLine('## ')}>
            標題
          </button>
          <button type="button" onClick={() => prefixLine('- ')}>
            清單
          </button>
          <button type="button" onClick={() => prefixLine('> ')}>
            引用
          </button>
          <button type="button" className="tb-img" onClick={() => imgRef.current?.click()} disabled={imgBusy}>
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
          <input
            ref={imgRef}
            type="file"
            accept="image/*"
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
        </div>
        <textarea
          ref={bodyRef}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
          placeholder="開始打字…右邊會即時預覽。"
        />
        {(models.length > 0 || images.length > 0) && (
          <p className="hint">
            已附上:
            {images.length > 0 && ` 🖼️ ${images.length} 張圖片`}
            {models.length > 0 && ` 🧊 ${models.length} 個 3D 模型`}
            (發布時一起上傳)
          </p>
        )}

        {error && <p className="error">⚠️ {error}</p>}

        <button className="btn publish" onClick={publish} disabled={status === 'publishing'}>
          {status === 'publishing' ? (edit ? '儲存中…請稍候' : '發布中…請稍候') : edit ? '💾 儲存修改' : '🚀 發布'}
        </button>
      </main>

      <Preview
        title={title}
        date={date}
        tags={tagList}
        body={body}
        modelGifs={modelGifs}
        images={images}
      />
    </div>
  );
}
