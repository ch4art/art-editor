import { useEffect, useState } from 'react';

export type ContentItem = {
  kind: 'post' | 'work';
  path: string;
  name: string;
  slug: string;
  title: string;
};

type TrashItem = {
  kind: 'post' | 'work';
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
  busy,
}: {
  onEditPost: (item: ContentItem) => void;
  onEditWork: (item: ContentItem) => void;
  busy: boolean;
}) {
  const [items, setItems] = useState<ContentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<TrashItem[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

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
      setTrash(null); // 回收桶內容變了,下次打開重新讀
    } catch (e) {
      setError(e instanceof Error ? e.message : '刪除失敗');
    } finally {
      setDeleting(null);
    }
  }

  async function openTrash() {
    const next = !trashOpen;
    setTrashOpen(next);
    if (next && trash === null) {
      try {
        setTrash(await window.api.content.trashList());
      } catch (e) {
        setError(e instanceof Error ? e.message : '讀取回收桶失敗');
        setTrash([]);
      }
    }
  }

  async function restore(item: TrashItem) {
    setRestoring(item.key);
    setError(null);
    try {
      await window.api.content.restore(item);
      setTrash((prev) => (prev ?? []).filter((x) => x.key !== item.key));
      await refresh(); // 還原的項目馬上回到上面的列表
    } catch (e) {
      setError(e instanceof Error ? e.message : '還原失敗');
    } finally {
      setRestoring(null);
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

          <section className="managesec trashsec">
            <h3>
              <button className="mini" onClick={openTrash}>
                🗑️ 資源回收桶 {trashOpen ? '▲' : '▼'}
              </button>
            </h3>
            {trashOpen && trash === null && <p className="waiting">⏳ 正在翻垃圾桶…</p>}
            {trashOpen && trash !== null && (
              <>
                {trash.length === 0 && <p className="hint">(回收桶是空的,真乾淨!)</p>}
                <ul className="managelist">
                  {trash.map((t) => (
                    <li key={t.key}>
                      <div className="mg-info">
                        <span className="mg-title">
                          {t.kind === 'post' ? '📝' : '🎨'} {t.title}
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
