import { useState } from 'react';
import PostForm, { type EditPost } from './PostForm';
import WorkForm, { type EditWork } from './WorkForm';
import Manage, { type ContentItem } from './Manage';
import { parsePost, parseWork } from './parse';

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function Editor({ login, onLogout }: { login: string; onLogout: () => void }) {
  const [tab, setTab] = useState<'post' | 'work' | 'manage'>('post');
  const [editPost, setEditPost] = useState<EditPost | null>(null);
  const [editWork, setEditWork] = useState<EditWork | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Tab clicks always mean "start fresh" — editing is entered via the manage list.
  function go(t: 'post' | 'work' | 'manage') {
    if (t !== 'manage') {
      setEditPost(null);
      setEditWork(null);
    }
    setLoadError(null);
    setTab(t);
  }

  async function startEditPost(item: ContentItem) {
    setLoadingEdit(true);
    setLoadError(null);
    try {
      const text = await window.api.content.getText(item.path);
      const p = parsePost(text);
      // Pull referenced images back down so the preview shows them and a
      // republish keeps them in place.
      const images: { filename: string; bytes: Uint8Array }[] = [];
      for (const name of p.imageNames) {
        try {
          const b64 = await window.api.content.getBinary(`src/content/blog/images/${name}`);
          images.push({ filename: name, bytes: fromBase64(b64) });
        } catch {
          /* 圖片不見了就略過,文章內容仍可編輯 */
        }
      }
      setEditWork(null);
      setEditPost({
        path: item.path,
        title: p.title,
        desc: p.description,
        date: p.date,
        tags: p.tags.join(', '),
        body: p.body,
        images,
      });
      setTab('post');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '載入文章失敗');
    } finally {
      setLoadingEdit(false);
    }
  }

  async function startEditWork(item: ContentItem) {
    setLoadingEdit(true);
    setLoadError(null);
    try {
      const text = await window.api.content.getText(item.path);
      const w = parseWork(text);
      let gifUrl: string | null = null;
      try {
        const b64 = await window.api.content.getBinary(`public/works/${w.thumb || `${item.slug}.gif`}`);
        gifUrl = URL.createObjectURL(
          new Blob([fromBase64(b64) as unknown as BlobPart], { type: 'image/gif' }),
        );
      } catch {
        /* 縮圖讀不到也沒關係 */
      }
      setEditPost(null);
      setEditWork({
        slug: item.slug,
        title: w.title,
        desc: w.description,
        env: w.environment,
        tags: w.tags.join(', '),
        order: w.order,
        gifUrl,
      });
      setTab('work');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '載入作品失敗');
    } finally {
      setLoadingEdit(false);
    }
  }

  function backToManage() {
    setEditPost(null);
    setEditWork(null);
    setTab('manage');
  }

  return (
    <div className="editor">
      <header className="topbar">
        <span className="brand">🐣 可愛編輯器</span>
        <nav className="tabs">
          <button className={tab === 'post' ? 'tab active' : 'tab'} onClick={() => go('post')}>
            ✏️ 寫文章
          </button>
          <button className={tab === 'work' ? 'tab active' : 'tab'} onClick={() => go('work')}>
            🎨 加作品
          </button>
          <button className={tab === 'manage' ? 'tab active' : 'tab'} onClick={() => go('manage')}>
            📚 管理
          </button>
        </nav>
        <span className="who">
          {login} ·{' '}
          <button className="link" onClick={onLogout}>
            登出
          </button>
        </span>
      </header>

      {loadError && <p className="error" style={{ margin: '12px 24px' }}>⚠️ {loadError}</p>}

      {tab === 'post' && (
        <PostForm
          key={editPost ? `edit:${editPost.path}` : 'new'}
          edit={editPost ?? undefined}
          onDone={backToManage}
        />
      )}
      {tab === 'work' && (
        <WorkForm
          key={editWork ? `edit:${editWork.slug}` : 'new'}
          edit={editWork ?? undefined}
          onDone={backToManage}
        />
      )}
      {tab === 'manage' && (
        <Manage onEditPost={startEditPost} onEditWork={startEditWork} busy={loadingEdit} />
      )}
    </div>
  );
}
