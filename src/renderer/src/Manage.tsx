import { useEffect, useState } from 'react';

export type ContentItem = {
  kind: 'post' | 'work';
  path: string;
  name: string;
  slug: string;
  title: string;
};

const SITE = 'https://ch4art.github.io';

export default function Manage({
  onEditPost,
  onEditWork,
  busy,
}: {
  onEditPost: (item: ContentItem) => void;
  onEditWork: (item: ContentItem) => void;
  busy: boolean;
}) {
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  async function refresh() {
    setItems(null);
    setError(null);
    try {
      setItems(await window.api.content.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : '讀取失敗');
      setItems([]);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function remove(item: ContentItem) {
    const what = item.kind === 'post' ? '文章' : '作品';
    if (!window.confirm(`確定要刪除${what}「${item.title}」嗎?\n刪掉就找不回來囉!`)) return;
    setDeleting(item.path);
    setError(null);
    try {
      await window.api.content.remove(item);
      setItems((prev) => (prev ?? []).filter((x) => x.path !== item.path));
    } catch (e) {
      setError(e instanceof Error ? e.message : '刪除失敗');
    } finally {
      setDeleting(null);
    }
  }

  function viewUrl(item: ContentItem): string {
    return item.kind === 'post' ? `${SITE}/blog/${item.slug}/` : `${SITE}/portfolio/${item.slug}/`;
  }

  function section(kind: 'post' | 'work', heading: string) {
    const list = (items ?? []).filter((x) => x.kind === kind);
    return (
      <section className="managesec">
        <h3>{heading}</h3>
        {list.length === 0 && <p className="hint">(目前沒有東西)</p>}
        <ul className="managelist">
          {list.map((item) => (
            <li key={item.path}>
              <div className="mg-info">
                <span className="mg-title">{item.title}</span>
                <span className="mg-slug">{item.name}</span>
              </div>
              <div className="mg-actions">
                <button
                  className="mini"
                  onClick={() => window.api.openExternal(viewUrl(item))}
                  title="在瀏覽器打開"
                >
                  👀 看
                </button>
                <button
                  className="mini edit"
                  disabled={busy || deleting !== null}
                  onClick={() => (kind === 'post' ? onEditPost(item) : onEditWork(item))}
                >
                  ✏️ 編輯
                </button>
                <button
                  className="mini danger"
                  disabled={busy || deleting !== null}
                  onClick={() => remove(item)}
                >
                  {deleting === item.path ? '⏳ 刪除中…' : '🗑️ 刪除'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <main className="form manage">
      <h2>
        管理已發布的內容 📚{' '}
        <button className="mini" onClick={refresh} disabled={items === null}>
          🔄 重新整理
        </button>
      </h2>
      {items === null && <p className="waiting">⏳ 正在從 GitHub 讀取清單…</p>}
      {busy && <p className="waiting">⏳ 正在載入內容,馬上就好…</p>}
      {error && <p className="error">⚠️ {error}</p>}
      {items !== null && (
        <>
          {section('post', '📝 文章')}
          {section('work', '🎨 作品')}
          <p className="hint">編輯或刪除後,網站大約 1–2 分鐘會自動更新。</p>
        </>
      )}
    </main>
  );
}
