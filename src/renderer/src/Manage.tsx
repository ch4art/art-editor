import { useEffect, useState } from 'react';

export type ContentItem = {
  kind: 'post' | 'work' | 'drawing';
  path: string;
  name: string;
  slug: string;
  title: string;
};

type TrashItem = {
  kind: 'post' | 'work' | 'drawing';
  title: string;
  date: string;
  parent: string;
  files: string[];
  key: string;
};

const SITE = 'https://ch4art.github.io';

export default function Manage({
  onEditPost,
  onEditWork,
  onEditDrawing,
  busy,
}: {
  onEditPost: (item: ContentItem) => void;
  onEditWork: (item: ContentItem) => void;
  onEditDrawing: (item: ContentItem) => void;
  busy: boolean;
}) {
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<TrashItem[] | null>(null);
  const [trashError, setTrashError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

  function loadTrash() {
    setTrash(null);
    setTrashError(null);
    window.api.content
      .trashList()
      .then(setTrash)
      .catch((e) => {
        setTrashError(e instanceof Error ? e.message : '讀取回收桶失敗');
        setTrash([]);
      });
  }

  function refresh() {
    setItems(null);
    setError(null);
    // 清單跟回收桶同時抓,不互相等
    window.api.content
      .list()
      .then(setItems)
      .catch((e) => {
        setError(e instanceof Error ? e.message : '讀取失敗');
        setItems([]);
      });
    loadTrash();
  }

  useEffect(() => {
    refresh();
  }, []);

  async function remove(item: ContentItem) {
    const what = item.kind === 'post' ? '文章' : item.kind === 'work' ? '模型' : '畫作';
    if (
      !window.confirm(
        `確定要刪除${what}「${item.title}」嗎?\n(放心,之後還是可以從下面的資源回收桶撈回來)`,
      )
    )
      return;
    setDeleting(item.path);
    setError(null);
    try {
      await window.api.content.remove(item);
      setItems((prev) => (prev ?? []).filter((x) => x.path !== item.path));
      loadTrash(); // 剛刪的馬上出現在回收桶
    } catch (e) {
      setError(e instanceof Error ? e.message : '刪除失敗');
    } finally {
      setDeleting(null);
    }
  }

  async function restore(item: TrashItem) {
    setRestoring(item.key);
    setError(null);
    try {
      await window.api.content.restore(item);
      setTrash((prev) => (prev ?? []).filter((x) => x.key !== item.key));
      refresh(); // 還原的項目馬上回到上面的列表
    } catch (e) {
      setError(e instanceof Error ? e.message : '還原失敗');
    } finally {
      setRestoring(null);
    }
  }

  function viewUrl(item: ContentItem): string {
    if (item.kind === 'post') return `${SITE}/blog/${item.slug}/`;
    if (item.kind === 'drawing') return `${SITE}/gallery-2d/#${item.slug}`;
    return `${SITE}/portfolio/${item.slug}/`;
  }

  function section(kind: 'post' | 'work' | 'drawing', heading: string) {
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
                  onClick={() =>
                    kind === 'post'
                      ? onEditPost(item)
                      : kind === 'drawing'
                        ? onEditDrawing(item)
                        : onEditWork(item)
                  }
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
        </button>{' '}
        <button className="mini" onClick={() => setTrashOpen((v) => !v)}>
          🗑️ 回收桶{trash !== null ? `(${trash.length})` : ''} {trashOpen ? '▲' : '▼'}
        </button>
      </h2>
      {items === null && <p className="waiting">⏳ 正在從 GitHub 讀取清單…</p>}
      {busy && <p className="waiting">⏳ 正在載入內容,馬上就好…</p>}
      {error && <p className="error">⚠️ {error}</p>}
      {items !== null && (
        <>
          {section('post', '📝 文章')}
          {section('drawing', '🖍️ 畫作')}
          {section('work', '🧊 模型')}
          <p className="hint">編輯或刪除後,網站大約 1–2 分鐘會自動更新。</p>

          <section className="managesec trashsec">
            {trashOpen && <h3>🗑️ 資源回收桶</h3>}
            {trashOpen && trash === null && <p className="waiting">⏳ 正在翻垃圾桶…</p>}
            {trashOpen && trashError && <p className="error">⚠️ {trashError}</p>}
            {trashOpen && trash !== null && (
              <>
                {trash.length === 0 && !trashError && (
                  <p className="hint">(回收桶是空的,真乾淨!)</p>
                )}
                <ul className="managelist">
                  {trash.map((t) => (
                    <li key={t.key}>
                      <div className="mg-info">
                        <span className="mg-title">
                          {t.kind === 'post' ? '📝' : t.kind === 'drawing' ? '🖍️' : '🧊'} {t.title}
                        </span>
                        <span className="mg-slug">
                          刪於 {t.date ? t.date.slice(0, 10).split('-').join('/') : '?'}
                        </span>
                      </div>
                      <div className="mg-actions">
                        <button
                          className="mini edit"
                          disabled={restoring !== null}
                          onClick={() => restore(t)}
                        >
                          {restoring === t.key ? '⏳ 還原中…' : '↩️ 還原'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {trash.length > 0 && (
                  <p className="hint">
                    刪掉的東西其實都還在網站的歷史紀錄裡,按「還原」就會放回去(網站 1~2
                    分鐘後更新)。
                  </p>
                )}
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
