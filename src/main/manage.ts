// Listing / reading / deleting published content via the GitHub API, so the
// editor can edit or remove posts and works after publishing.
import { ghApi, commitFiles, type CommitFile } from './publish';
import { REPO } from './github';

export type ContentItem = {
  kind: 'post' | 'work' | 'drawing';
  path: string; // repo path of the .md/.mdx
  name: string; // filename
  slug: string; // filename without extension (drawings: folder name)
  title: string;
};

function parseTitle(src: string): string {
  const m = src.match(/^title:\s*(.*)$/m);
  if (!m) return '';
  return m[1].trim().replace(/^"(.*)"$/, '$1');
}

export async function listContent(token: string): Promise<ContentItem[]> {
  const { owner, repo } = REPO;
  const items: ContentItem[] = [];
  for (const kind of ['post', 'work'] as const) {
    const dir = kind === 'post' ? 'src/content/blog' : 'src/content/works';
    const list = await ghApi(token, `/repos/${owner}/${repo}/contents/${dir}`);
    for (const f of list as { type: string; name: string }[]) {
      if (f.type !== 'file' || !/\.(md|mdx)$/i.test(f.name)) continue;
      const text = await getContentText(token, `${dir}/${f.name}`);
      items.push({
        kind,
        path: `${dir}/${f.name}`,
        name: f.name,
        slug: f.name.replace(/\.(md|mdx)$/i, ''),
        title: parseTitle(text) || f.name,
      });
    }
  }
  // 2D 畫作:一畫一資料夾(src/content/drawings/<slug>/index.md)。
  // 目錄可能還不存在(網站 v2 上線前)→ 安靜跳過。
  try {
    const dir = 'src/content/drawings';
    const list = await ghApi(token, `/repos/${owner}/${repo}/contents/${dir}`);
    for (const f of list as { type: string; name: string }[]) {
      if (f.type !== 'dir') continue;
      const path = `${dir}/${f.name}/index.md`;
      try {
        const text = await getContentText(token, path);
        items.push({
          kind: 'drawing',
          path,
          name: f.name,
          slug: f.name,
          title: parseTitle(text) || f.name,
        });
      } catch {
        /* 資料夾裡沒有 index.md 就跳過 */
      }
    }
  } catch {
    /* drawings 目錄不存在 — 還沒發過畫 */
  }
  return items;
}

export async function getContentText(token: string, path: string, ref?: string): Promise<string> {
  return Buffer.from(await getContentBase64(token, path, ref), 'base64').toString('utf-8');
}

export async function getContentBase64(token: string, path: string, ref?: string): Promise<string> {
  const { owner, repo } = REPO;
  const q = ref ? `?ref=${ref}` : '';
  const file = await ghApi(token, `/repos/${owner}/${repo}/contents/${path}${q}`);
  if (file.content) return (file.content as string).replace(/\n/g, '');
  // Files >1MB: the contents API omits content — fetch the raw download URL.
  const res = await fetch(file.download_url as string);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

export async function deleteContent(
  token: string,
  item: { kind: 'post' | 'work' | 'drawing'; path: string; title: string },
): Promise<void> {
  const files: { path: string; del: true }[] = [{ path: item.path, del: true }];
  if (item.kind === 'work') {
    // Also remove the work's model + thumbnail.
    const text = await getContentText(token, item.path);
    const model = text.match(/^model:\s*(.*)$/m)?.[1]?.trim();
    const thumb = text.match(/^thumb:\s*(.*)$/m)?.[1]?.trim();
    if (model) files.push({ path: `public/models/${model}`, del: true });
    if (thumb) files.push({ path: `public/works/${thumb}`, del: true });
  }
  if (item.kind === 'drawing') {
    // 連同同資料夾的圖檔一起刪(image: ./art.png)。
    const text = await getContentText(token, item.path);
    const img = text.match(/^image:\s*\.\/(.*)$/m)?.[1]?.trim();
    const dir = item.path.replace(/\/index\.md$/i, '');
    if (img) files.push({ path: `${dir}/${img}`, del: true });
  }
  await commitFiles(token, files, `刪除:${item.title}`);
}

// ---------- 資源回收桶 ----------
// Git history keeps every deleted file forever; "trash" is just a friendly
// view over recent commits that removed content, with one-click restore.

export type TrashItem = {
  kind: 'post' | 'work' | 'drawing';
  title: string;
  date: string; // ISO commit date
  parent: string; // commit sha holding the file contents to restore
  files: string[]; // removed paths to bring back
  key: string;
};

const CONTENT_MD =
  /^src\/content\/(blog|works)\/[^/]+\.(md|mdx)$|^src\/content\/drawings\/[^/]+\/index\.md$/i;

export async function listTrash(token: string): Promise<TrashItem[]> {
  const { owner, repo } = REPO;
  // Only commits touching content — keeps the scan small.
  const commits = await ghApi(
    token,
    `/repos/${owner}/${repo}/commits?path=src/content&per_page=30`,
  );
  const items: TrashItem[] = [];
  const seen = new Set<string>();
  for (const c of commits as any[]) {
    if (!c.parents?.length) continue;
    const detail = await ghApi(token, `/repos/${owner}/${repo}/commits/${c.sha}`);
    const removed = (detail.files ?? [])
      .filter((f: any) => f.status === 'removed')
      .map((f: any) => String(f.filename));
    const md = removed.find((p: string) => CONTENT_MD.test(p));
    if (!md || seen.has(md)) continue;
    seen.add(md); // newest deletion of a path wins
    // Skip when the file exists again at HEAD (already restored / re-published).
    try {
      await ghApi(token, `/repos/${owner}/${repo}/contents/${md}`);
      continue;
    } catch {
      /* still deleted — keep it */
    }
    const parent = String(c.parents[0].sha);
    let title = '';
    try {
      const text = await getContentText(token, md, parent);
      title = text.match(/^title:\s*(.*)$/m)?.[1]?.trim().replace(/^"(.*)"$/, '$1') ?? '';
    } catch {
      /* title stays empty → filename below */
    }
    items.push({
      kind: md.includes('/works/') ? 'work' : md.includes('/drawings/') ? 'drawing' : 'post',
      // 畫作的檔名都叫 index.md — 後備標題用資料夾名才認得出來
      title: title || (md.includes('/drawings/') ? md.split('/').slice(-2)[0] : md.split('/').pop()!),
      date: String(c.commit?.author?.date ?? ''),
      parent,
      files: removed,
      key: `${md}@${c.sha}`,
    });
  }
  return items;
}

export async function restoreContent(
  token: string,
  item: { title: string; parent: string; files: string[] },
): Promise<void> {
  const files: CommitFile[] = [];
  for (const path of item.files) {
    const b64 = await getContentBase64(token, path, item.parent);
    files.push({ path, content: b64, encoding: 'base64' });
  }
  await commitFiles(token, files, `還原:${item.title}`);
}
