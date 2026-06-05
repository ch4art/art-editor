// Builds the .mdx file content + filename for a blog post.
// (A component-free .mdx renders exactly like Markdown — we keep everything
// .mdx so the file format is uniform and can embed 3D later.)

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** A YAML double-quoted scalar. JSON string escaping is YAML-compatible. */
function yamlStr(s: string): string {
  return JSON.stringify(s ?? '');
}

export type BlogPostInput = {
  title: string;
  description: string;
  date: string; // 'YYYY-MM-DD'
  tags: string[];
  body: string;
};

/** Escape { } in user text — MDX treats a bare "{" as an expression and the
 *  whole site build would fail. Code fences/inline code are skipped (a
 *  backslash would show literally there). Runs BEFORE the 3D-token transform
 *  so the generated <ModelViewer> JSX keeps its braces. */
function escapeMdxBraces(src: string): string {
  return src
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((seg, i) =>
      i % 2 === 1
        ? seg
        : // un-escape first so re-publishing an already-escaped body is idempotent
          seg.replace(/\\([{}])/g, '$1').replace(/([{}])/g, '\\$1'),
    )
    .join('');
}

export function buildBlogPost(post: BlogPostInput): { slug: string; mdx: string } {
  const now = new Date();
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const slug = `post-${stamp}`;

  const tags = post.tags.length
    ? `[${post.tags.map((t) => yamlStr(t)).join(', ')}]`
    : '[]';

  // Turn the friendly token "<<3D模型: file.glb>>" the editor inserts into the
  // real (interactive) component, and auto-import it — so the user never sees JSX.
  let usesModel = false;
  const body = escapeMdxBraces(post.body).replace(/<<3D模型:\s*([^>]+?)\s*>>/g, (_m, file) => {
    usesModel = true;
    const f = String(file).trim();
    return (
      '<ModelViewer client:only="react" src={`${import.meta.env.BASE_URL}models/' +
      f +
      '`} environment="city" height={360} />'
    );
  });

  const lines = [
    '---',
    `title: ${yamlStr(post.title)}`,
    `description: ${yamlStr(post.description || post.title)}`,
    `pubDate: ${post.date}`,
    `tags: ${tags}`,
    'draft: false',
    '---',
    '',
  ];
  if (usesModel) {
    lines.push("import ModelViewer from '../../components/three/ModelViewer.tsx';", '');
  }
  lines.push(body.trim(), '');

  return { slug, mdx: lines.join('\n') };
}

function stamp(): string {
  const now = new Date();
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

/** A URL-safe slug from a model filename, with a timestamp fallback. */
export function sanitizeSlug(filename: string): string {
  const base = filename
    .replace(/\.[a-z0-9]+$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `work-${stamp()}`;
}

export type WorkInput = {
  title: string;
  description: string;
  environment: string;
  tags: string[];
  body: string;
  /** Preserved when editing an existing work; defaults to today's date number. */
  order?: number;
};

export function buildWork(work: WorkInput, slug: string): string {
  const now = new Date();
  const order =
    work.order ?? Number(`${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`);
  const tags = work.tags.length ? `[${work.tags.map((t) => yamlStr(t)).join(', ')}]` : '[]';

  return [
    '---',
    `title: ${yamlStr(work.title)}`,
    `description: ${yamlStr(work.description || work.title)}`,
    `model: ${slug}.glb`,
    `thumb: ${slug}.gif`,
    `environment: ${work.environment}`,
    `order: ${order}`,
    `tags: ${tags}`,
    '---',
    '',
    (work.body || '').trim(),
    '',
  ].join('\n');
}
