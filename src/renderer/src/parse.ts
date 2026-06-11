// Parses published .md/.mdx back into editor-friendly fields, so posts and
// works can be edited. Reverses the friendly-token transform: the user never
// sees JSX, only "<<3D模型: file.glb>>".

export type ParsedPost = {
  title: string;
  description: string;
  date: string; // YYYY-MM-DD
  tags: string[];
  body: string; // import stripped, ModelViewer JSX → tokens
  imageNames: string[]; // referenced ./images/<name> files
  /** 私密文章的密文(需要密語才能在編輯器裡打開)。 */
  privateCipher?: string;
};

export type ParsedWork = {
  title: string;
  description: string;
  environment: string;
  order?: number;
  tags: string[];
  model: string;
  thumb: string;
};

function splitFrontmatter(src: string): { fm: string; body: string } {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: '', body: src };
  return { fm: m[1], body: src.slice(m[0].length) };
}

function field(fm: string, key: string): string {
  const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

/** Strip optional YAML double quotes (our files use JSON-compatible quoting). */
function unquote(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

function parseTags(raw: string): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.map(String);
  } catch {
    /* fall through */
  }
  return raw
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => unquote(t.trim()))
    .filter(Boolean);
}

const MODEL_JSX =
  /<ModelViewer\b[^>]*?src=\{`\$\{import\.meta\.env\.BASE_URL\}models\/([^`]+)`\}[^>]*?\/>/g;
const IMPORT_LINE = /^import\s+ModelViewer\s+from\s+[^\n]*\n?/gm;
const IMAGE_REF = /!\[[^\]]*\]\(\.\/images\/([^)\s]+)\)/g;

export function parsePost(src: string): ParsedPost {
  const { fm, body: raw } = splitFrontmatter(src);
  const body = raw
    .replace(IMPORT_LINE, '')
    .replace(MODEL_JSX, (_m, file) => `<<3D模型: ${String(file).trim()}>>`)
    .trim();
  const imageNames = [...body.matchAll(IMAGE_REF)].map((m) => m[1]);
  const dateRaw = unquote(field(fm, 'pubDate'));
  const isPrivate = field(fm, 'private') === 'true';
  const cipher = unquote(field(fm, 'cipher'));
  return {
    title: unquote(field(fm, 'title')),
    description: unquote(field(fm, 'description')),
    date: dateRaw.slice(0, 10),
    tags: parseTags(field(fm, 'tags')),
    body: isPrivate ? '' : body,
    imageNames: isPrivate ? [] : [...new Set(imageNames)],
    privateCipher: isPrivate && cipher ? cipher : undefined,
  };
}

export function parseWork(src: string): ParsedWork {
  const { fm } = splitFrontmatter(src);
  const orderRaw = field(fm, 'order');
  return {
    title: unquote(field(fm, 'title')),
    description: unquote(field(fm, 'description')),
    environment: field(fm, 'environment') || 'city',
    order: orderRaw ? Number(orderRaw) : undefined,
    tags: parseTags(field(fm, 'tags')),
    model: field(fm, 'model'),
    thumb: field(fm, 'thumb'),
  };
}

export type ParsedDrawing = {
  title: string;
  alt: string;
  description: string;
  date: string; // YYYY-MM-DD(編輯時保留,改字不會把畫頂到牆最前面)
  tags: string[];
  featured: boolean;
  imageFile: string; // ./ 後面的檔名,如 art.png
};

export function parseDrawing(src: string): ParsedDrawing {
  const { fm } = splitFrontmatter(src);
  return {
    title: unquote(field(fm, 'title')),
    alt: unquote(field(fm, 'alt')),
    description: unquote(field(fm, 'description')),
    date: unquote(field(fm, 'date')).slice(0, 10),
    tags: parseTags(field(fm, 'tags')),
    featured: field(fm, 'featured') === 'true',
    imageFile: field(fm, 'image').replace(/^\.\//, ''),
  };
}
