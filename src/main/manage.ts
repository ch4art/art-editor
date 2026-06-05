// Listing / reading / deleting published content via the GitHub API, so the
// editor can edit or remove posts and works after publishing.
import { ghApi, commitFiles } from './publish';
import { REPO } from './github';

export type ContentItem = {
  kind: 'post' | 'work';
  path: string; // repo path of the .md/.mdx
  name: string; // filename
  slug: string; // filename without extension
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
  return items;
}

export async function getContentText(token: string, path: string): Promise<string> {
  return Buffer.from(await getContentBase64(token, path), 'base64').toString('utf-8');
}

export async function getContentBase64(token: string, path: string): Promise<string> {
  const { owner, repo } = REPO;
  const file = await ghApi(token, `/repos/${owner}/${repo}/contents/${path}`);
  if (file.content) return (file.content as string).replace(/\n/g, '');
  // Files >1MB: the contents API omits content — fetch the raw download URL.
  const res = await fetch(file.download_url as string);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

export async function deleteContent(
  token: string,
  item: { kind: 'post' | 'work'; path: string; title: string },
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
  await commitFiles(token, files, `刪除:${item.title}`);
}
