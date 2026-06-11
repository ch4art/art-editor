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
  /** 私密文章:body 留空,內容已在 renderer 加密成 cipher。 */
  private?: boolean;
  cipher?: string;
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

  // 私密文章:內文只放占位字,真正的內容在 cipher(網站端輸入密語解鎖)。
  // 標題以外的欄位一律不外洩 —— description/tags 會出現在文章列表、RSS、
  // 分享預覽,所以強制蓋成占位值,不用作者打的字(避免不小心把劇透寫在介紹)。
  if (post.private && post.cipher) {
    const mdx = [
      '---',
      `title: ${yamlStr(post.title)}`,
      `description: ${yamlStr('🔒 私密文章')}`,
      `pubDate: ${post.date}`,
      'tags: []',
      'draft: false',
      'private: true',
      `cipher: ${yamlStr(post.cipher)}`,
      '---',
      '',
      '這是一篇私密文章,要有通關密語才能看 🔒',
      '',
    ].join('\n');
    return { slug, mdx };
  }

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

// ---------- 2D 畫作(v2 網站的 drawings collection)----------
// 一畫一資料夾:src/content/drawings/<slug>/index.md + 圖檔共置。
// 網站 schema:title、date、image、alt 必填;其餘 optional/有預設。

export type DrawingInput = {
  title: string;
  /** 圖片描述(無障礙 alt)。留空時自動用標題,確保 schema 永遠過。 */
  alt: string;
  description: string;
  tags: string[];
  featured: boolean;
  /** 編輯時保留原日期(改字不該把畫頂到牆的最前面)。 */
  date?: string; // 'YYYY-MM-DD'
};

export function drawingSlug(): string {
  return `draw-${stamp()}`;
}

export function buildDrawing(d: DrawingInput, imageFile: string): string {
  const now = new Date();
  const date =
    d.date ?? `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const tags = d.tags.length ? `[${d.tags.map((t) => yamlStr(t)).join(', ')}]` : '[]';

  const lines = [
    '---',
    `title: ${yamlStr(d.title)}`,
    `date: ${date}`,
    `image: ./${imageFile}`,
    `alt: ${yamlStr(d.alt.trim() || d.title)}`,
  ];
  if (d.description.trim()) lines.push(`description: ${yamlStr(d.description.trim())}`);
  lines.push(`tags: ${tags}`);
  if (d.featured) lines.push('featured: true');
  lines.push('---', '');
  return lines.join('\n');
}

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
