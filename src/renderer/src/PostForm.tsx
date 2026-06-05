import { useEffect, useMemo, useRef, useState } from 'react';
import RichEditor, { type RichEditorHandle } from './RichEditor';
import { optimizeGlb } from './optimize';
import { generateThumbnailGif } from './thumb';
import { compressImage, imageMime } from './image';
import { saveDraft, loadDraft, clearDraft } from './draft';
import { encryptPrivate, openPrivate, decryptImage } from './crypto';

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
  isPrivate?: boolean;
  pw?: string;
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
  /** 私密文章:需要密語才能在編輯器裡打開內容。 */
  privateCipher?: string;
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
  const [status, setStatus] = useState<'idle' | 'publishing' | 'deploying' | 'done' | 'error'>(
    'idle',
  );
  const [doneNote, setDoneNote] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [restored, setRestored] = useState(false);
  const [waitSec, setWaitSec] = useState(0);
  // 私密文章
  const [isPrivate, setIsPrivate] = useState(Boolean(edit?.privateCipher));
  const [pw, setPw] = useState('');
  const [locked, setLocked] = useState(Boolean(edit?.privateCipher)); // 編輯私密文章:尚未輸入密語
  const [unlockErr, setUnlockErr] = useState<string | null>(null);
  const [unlockBusy, setUnlockBusy] = useState(false);
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
          setIsPrivate(Boolean(d.isPrivate));
          // 密語沒有存檔,還原後請重打
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

  // ---------- 等部署時數秒,讓等待有感覺 ----------
  useEffect(() => {
    if (status !== 'deploying') return;
    setWaitSec(0);
    const t = setInterval(() => setWaitSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [status]);

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
        isPrivate,
        // 通關密語「絕不」寫到磁碟 —— 還原草稿時請作者重打一次。
      };
      saveDraft(DRAFT_KEY, d).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [title, desc, date, tags, body, models, images, status, isPrivate]);

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

  // 編輯私密文章:輸入密語解鎖內容
  async function unlock() {
    if (!edit?.privateCipher) return;
    setUnlockBusy(true);
    setUnlockErr(null);
    try {
      const { payload, key } = await openPrivate(pw, edit.privateCipher);
      // 圖片若有任何一張解不開,先擋下編輯 —— 否則「儲存修改」會把那張
      // 圖片永久弄丟。寧可要作者重試,也不要默默掉圖。
      const imgs: AttachedImage[] = [];
      for (const ref of payload.images ?? []) {
        const b64 = await window.api.content.getBinary(`public/${ref.file}`);
        const bytes = await decryptImage(key, ref.iv, fromBase64(b64));
        imgs.push({
          filename: ref.name,
          bytes,
          url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: ref.type })),
        });
      }
      setBody(payload.md);
      setSeed((s) => ({ md: payload.md, n: s.n + 1 }));
      setImages(imgs);
      setLocked(false);
    } catch {
      setUnlockErr('密語不對,或有圖片載入失敗 —— 請確認密語和網路後再試一次');
    } finally {
      setUnlockBusy(false);
    }
  }

  async function publish() {
    if (!title.trim()) {
      setError('標題不能空白喔');
      return;
    }
    if (isPrivate) {
      if (!pw.trim()) {
        setError('私密文章要先設定通關密語喔');
        return;
      }
      if (body.includes('<<3D模型')) {
        setError('私密文章目前不能放 3D 模型,先把它刪掉再發布');
        return;
      }
      // 把公開文章改成私密:舊版明文永遠留在 GitHub 歷史裡,要講清楚
      if (edit && !edit.privateCipher) {
        if (
          !window.confirm(
            '這篇文章本來是公開的。\n改成私密後,新內容會上鎖,但「之前公開過的版本」會永遠留在 GitHub 的歷史紀錄裡撈得到。\n如果是真的不能被看到的祕密,建議改開一篇全新的私密文章。\n\n還是要把這篇改成私密嗎?',
          )
        )
          return;
      }
    }
    // 把私密文章改回公開:內容會變成所有人都看得到,而且永遠留在網路上
    if (edit?.privateCipher && !isPrivate) {
      if (
        !window.confirm(
          '⚠️ 這篇原本是「私密文章」!\n按儲存後,內文和圖片會變成所有人都看得到,而且永遠留在網路紀錄上,收不回來。\n\n確定要公開嗎?',
        )
      )
        return;
    }
    setError(null);
    setStatus('publishing');
    try {
      // 私密文章:內文+圖片在這裡加密,密語不會離開這台電腦
      const sealed = isPrivate
        ? await encryptPrivate(
            pw,
            body,
            usedImages.map((i) => ({ filename: i.filename, bytes: i.bytes })),
          )
        : null;
      const res = await window.api.publish.post({
        title: title.trim(),
        description: desc.trim(),
        date,
        tags: tagList,
        body: sealed ? '' : body,
        private: isPrivate || undefined,
        cipher: sealed?.cipher,
        encImages: sealed?.encImages,
        models: sealed
          ? []
          : usedModels.map((m) => ({ filename: m.filename, base64: toBase64(m.bytes) })),
        images: sealed
          ? []
          : usedImages.map((i) => ({ filename: i.filename, base64: toBase64(i.bytes) })),
        existingPath: edit?.path,
      });
      setResult(res);
      if (!edit) clearDraft(DRAFT_KEY).catch(() => {});
      // 等到網站真的部署完成,「看文章」按下去保證是新的。
      // 上傳已經成功了 — 之後不管發生什麼,都不能再顯示「發布失敗」。
      setStatus('deploying');
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
      setStatus('done');
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
    setIsPrivate(false);
    setPw('');
    setStatus('idle');
    setDoneNote(null);
    setResult(null);
    setError(null);
    setRestored(false);
    clearDraft(DRAFT_KEY).catch(() => {});
  }

  if (status === 'done' && result) {
    return (
      <div className="form">
        <div className="card center">
          <h1>{edit ? '✨ 更新完成!' : '🎉 文章上線了!'}</h1>
          <p>{doneNote ?? '網站已經更新好,點下面就能看到!'}</p>
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

      {locked ? (
        <div className="card center">
          <h1>🔒</h1>
          <p className="hint" style={{ fontSize: '1rem' }}>
            這是私密文章,輸入通關密語才能編輯。
          </p>
          <input
            type="password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !unlockBusy && pw.trim()) unlock();
            }}
            placeholder="通關密語…"
            style={{ maxWidth: 260, margin: '10px auto' }}
          />
          <div className="btnrow">
            <button className="btn" onClick={unlock} disabled={unlockBusy || !pw.trim()}>
              {unlockBusy ? '⏳ 解鎖中…' : '解鎖 ✨'}
            </button>
          </div>
          {unlockErr && <p className="error">⚠️ {unlockErr}</p>}
        </div>
      ) : (
      <div className="writegrid">
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
                title="插入圖片(也可以直接貼上或拖進來)"
              >
                {imgBusy ? '⏳…' : '🖼️ 圖片'}
              </button>
              <button
                type="button"
                className="tb-3d"
                onClick={() => fileRef.current?.click()}
                disabled={modelBusy || isPrivate}
                title={
                  isPrivate ? '私密文章目前不能放 3D 模型' : '插入 3D 模型(也可以把 .glb 拖進來)'
                }
              >
                {modelBusy ? '⏳…' : '🧊 3D'}
              </button>
            </>
          }
        />

        <aside className="metabar">
          <label>
            一句話介紹
            <input
              value={isPrivate ? '' : desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder={isPrivate ? '私密文章不顯示介紹' : '顯示在文章列表(可留空)'}
              disabled={isPrivate}
            />
          </label>
          <label>
            日期
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label>
            標籤
            <input
              value={isPrivate ? '' : tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder={isPrivate ? '私密文章不顯示標籤' : '用逗號分隔,如:日常, 貓咪'}
              disabled={isPrivate}
            />
          </label>
          <label className="prilabel">
            <span>
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />{' '}
              🔒 私密文章
            </span>
          </label>
          {isPrivate && (
            <label>
              通關密語
              <input
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="看的人要輸入這個"
              />
              <span className="hint" style={{ margin: 0 }}>
                🔒 內文和圖片會上鎖,只有知道密語的人能看。
                <br />
                ⚠️ 但<b>標題和日期還是公開的</b>,大家都看得到,所以標題別寫祕密。
                <br />
                忘記密語就誰都打不開了!(私密文章不能放 3D 模型)
              </span>
            </label>
          )}
          {(usedModels.length > 0 || usedImages.length > 0) && (
            <p className="hint">
              會一起上傳:
              {usedImages.length > 0 && ` 🖼️ ${usedImages.length} 張圖片`}
              {usedModels.length > 0 && ` 🧊 ${usedModels.length} 個 3D 模型`}
            </p>
          )}
          {error && <p className="error">⚠️ {error}</p>}
          <button
            className="btn publish"
            onClick={publish}
            disabled={status === 'publishing' || status === 'deploying'}
          >
            {status === 'publishing' ? (
              <>
                <span className="btn-ring" />
                {edit ? '儲存中…' : '上傳中…'}
              </>
            ) : status === 'deploying' ? (
              <>
                <span className="btn-ring" />
                🐣 網站更新中…
              </>
            ) : edit ? (
              '💾 儲存修改'
            ) : (
              '🚀 發布'
            )}
          </button>
          {status === 'deploying' && (
            <p className="hint">
              上傳完成!網站要整個重新蓋一次,<b>大約 1~2 分鐘</b>
              (跟文章長短沒關係)~已經等了 {waitSec} 秒,好了會直接告訴你!
            </p>
          )}
        </aside>
      </div>
      )}

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
    </main>
  );
}
