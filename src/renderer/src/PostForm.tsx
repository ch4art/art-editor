import { useRef, useState } from 'react';
import { optimizeGlb } from './optimize';

function today(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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

export default function PostForm() {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(today());
  const [tags, setTags] = useState('');
  const [body, setBody] = useState('');
  const [models, setModels] = useState<Attached[]>([]);
  const [status, setStatus] = useState<'idle' | 'publishing' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<{ url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelBusy, setModelBusy] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
      insertAtCursor(`\n<<3D模型: ${f.name}>>\n`);
    } finally {
      setModelBusy(false);
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
      const tagList = tags
        .split(/[,，、\s]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const res = await window.api.publish.post({
        title: title.trim(),
        description: desc.trim(),
        date,
        tags: tagList,
        body,
        models: models.map((m) => ({ filename: m.filename, base64: toBase64(m.bytes) })),
      });
      setResult(res);
      setStatus('done');
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
    setStatus('idle');
    setResult(null);
    setError(null);
  }

  if (status === 'done' && result) {
    return (
      <div className="form">
        <div className="card center">
          <h1>🎉 發布成功!</h1>
          <p>文章已經送出,網站大約 1–2 分鐘後會自動更新。</p>
          <div className="btnrow">
            <button className="btn" onClick={() => window.api.openExternal(result.url)}>
              看文章
            </button>
            <button className="btn ghost" onClick={newPost}>
              再寫一篇
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="form">
      <h2>寫一篇新文章 ✏️</h2>

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
        <button
          type="button"
          className="tb-3d"
          onClick={() => fileRef.current?.click()}
          disabled={modelBusy}
        >
          {modelBusy ? '⏳ 處理模型中…' : '🧊 插入 3D 模型'}
        </button>
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
        rows={14}
        placeholder="開始打字…用上面的按鈕加粗體、標題、清單,或插入一個會轉的 3D 模型。"
      />
      {models.length > 0 && (
        <p className="hint">
          已附上 {models.length} 個 3D 模型:{models.map((m) => m.filename).join('、')}(發布時一起上傳)
        </p>
      )}

      {error && <p className="error">⚠️ {error}</p>}

      <button className="btn publish" onClick={publish} disabled={status === 'publishing'}>
        {status === 'publishing' ? '發布中…請稍候' : '🚀 發布'}
      </button>
    </main>
  );
}
