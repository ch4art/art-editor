import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { appendFileSync } from 'fs';
import * as gh from './github';
import {
  buildBlogPost,
  type BlogPostInput,
  buildWork,
  sanitizeSlug,
  type WorkInput,
} from './content';
import { commitFiles, waitForDeploy, type CommitFile } from './publish';
import {
  listContent,
  getContentText,
  getContentBase64,
  deleteContent,
  listTrash,
  restoreContent,
} from './manage';
import { gltfpackOptimize } from './gltfpack';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Self-diagnostics: anything that breaks the window gets written to
// %APPDATA%/<app>/debug.log so problems are debuggable without DevTools.
function dlog(msg: string): void {
  try {
    appendFileSync(join(app.getPath('userData'), 'debug.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* ignore */
  }
}

process.on('uncaughtException', (err) => dlog(`uncaughtException: ${err.stack || err}`));
process.on('unhandledRejection', (reason) => dlog(`unhandledRejection: ${reason}`));

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#FFF7F2',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  // Window-level diagnostics → debug.log
  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    dlog(`did-fail-load code=${code} desc=${desc} url=${url}`),
  );
  win.webContents.on('preload-error', (_e, path, error) =>
    dlog(`preload-error ${path}: ${error?.message || error}`),
  );
  win.webContents.on('render-process-gone', (_e, details) =>
    dlog(`render-process-gone reason=${details.reason} exitCode=${details.exitCode}`),
  );
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) dlog(`console[${level}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('did-finish-load', () => dlog('did-finish-load OK'));

  // The app is a single local page — block any in-window navigation
  // (e.g. a file dropped outside the editor would load its file:// URL).
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  dlog(`createWindow: dev=${Boolean(devUrl)} dir=${__dirname}`);
}

// ---------- IPC ----------
ipcMain.handle('ping', () => 'pong');

ipcMain.handle('github:status', async () => {
  const token = gh.loadToken();
  if (!token) return { loggedIn: false };
  try {
    const login = await gh.whoami(token);
    return { loggedIn: true, login };
  } catch {
    gh.clearToken();
    return { loggedIn: false };
  }
});

ipcMain.handle('github:login', async (event) => {
  const dc = await gh.requestDeviceCode();
  // Open the verification page and hand the code to the UI to display.
  shell.openExternal(dc.verification_uri);
  event.sender.send('github:code', {
    user_code: dc.user_code,
    verification_uri: dc.verification_uri,
  });
  const token = await gh.pollForToken(dc.device_code, dc.interval, dc.expires_in);
  gh.saveToken(token);
  const login = await gh.whoami(token);
  return { login };
});

ipcMain.handle('github:logout', () => {
  gh.clearToken();
  return true;
});

ipcMain.handle('app:openExternal', (_e, url: string) => {
  shell.openExternal(url);
});

// Big-file path: run gltfpack (wasm) in main on a file too large for the
// renderer to load. Returns the crushed glb as base64.
ipcMain.handle(
  'model:optimizeBig',
  async (_e, inputPath: string, opts: { simplifyRatio?: number }) => {
    const { bytes, before, after } = await gltfpackOptimize(inputPath, opts?.simplifyRatio ?? 1);
    return { base64: bytes.toString('base64'), before, after };
  },
);

ipcMain.handle(
  'publish:post',
  async (
    _e,
    post: BlogPostInput & {
      models?: { filename: string; base64: string }[];
      images?: { filename: string; base64: string }[];
      /** 私密文章的加密圖片(已含完整 repo 路徑)。 */
      encImages?: { path: string; base64: string }[];
      /** Set when editing — overwrite this file instead of creating a new one. */
      existingPath?: string;
    },
  ) => {
    const token = gh.loadToken();
    if (!token) throw new Error('尚未登入');
    const { slug: newSlug, mdx } = buildBlogPost(post);
    const slug = post.existingPath
      ? post.existingPath.replace(/^.*\//, '').replace(/\.(md|mdx)$/i, '')
      : newSlug;
    const path = post.existingPath ?? `src/content/blog/${slug}.mdx`;
    const files: CommitFile[] = [{ path, content: mdx, encoding: 'utf-8' }];
    for (const m of post.models ?? []) {
      files.push({ path: `public/models/${m.filename}`, content: m.base64, encoding: 'base64' });
    }
    for (const img of post.images ?? []) {
      files.push({
        path: `src/content/blog/images/${img.filename}`,
        content: img.base64,
        encoding: 'base64',
      });
    }
    for (const enc of post.encImages ?? []) {
      files.push({ path: enc.path, content: enc.base64, encoding: 'base64' });
    }
    // 公開文章被改成私密:把舊版引用的明文圖片從 repo HEAD 一起刪掉
    //(git 歷史仍會留著 — 真正的祕密請開新的私密文章)。
    if (post.existingPath && post.private) {
      try {
        const old = await getContentText(token, post.existingPath);
        for (const m of old.matchAll(/!\[[^\]]*\]\(\.\/images\/([^)\s]+)\)/g)) {
          files.push({ path: `src/content/blog/images/${m[1]}`, del: true });
        }
      } catch {
        /* 抓不到舊版就跳過刪除 */
      }
    }
    const sha = await commitFiles(
      token,
      files,
      `${post.existingPath ? '更新文章' : '文章'}:${post.title}`,
    );
    return { slug, path, sha, url: `https://${gh.REPO.owner}.github.io/blog/${slug}/` };
  },
);

ipcMain.handle(
  'publish:work',
  async (
    _e,
    work: WorkInput & {
      modelFilename?: string;
      modelBase64?: string;
      gifBase64?: string;
      /** Set when editing — overwrite this slug instead of creating a new one. */
      existingSlug?: string;
      /** Edit without re-uploading the model/GIF (text-only change). */
      keepAssets?: boolean;
    },
  ) => {
    const token = gh.loadToken();
    if (!token) throw new Error('尚未登入');
    const slug = work.existingSlug ?? sanitizeSlug(work.modelFilename ?? '');
    const md = buildWork(work, slug);
    const files: CommitFile[] = [];
    if (!work.keepAssets) {
      if (!work.modelBase64 || !work.gifBase64) throw new Error('缺少模型或縮圖');
      files.push(
        { path: `public/models/${slug}.glb`, content: work.modelBase64, encoding: 'base64' },
        { path: `public/works/${slug}.gif`, content: work.gifBase64, encoding: 'base64' },
      );
    }
    files.push({ path: `src/content/works/${slug}.md`, content: md, encoding: 'utf-8' });
    const sha = await commitFiles(
      token,
      files,
      `${work.existingSlug ? '更新作品' : '作品'}:${work.title}`,
    );
    return { slug, sha, url: `https://${gh.REPO.owner}.github.io/portfolio/${slug}/` };
  },
);

// Poll the Pages deploy for a commit — resolves when the site is live.
ipcMain.handle('publish:waitLive', async (_e, sha: string) => {
  const token = gh.loadToken();
  if (!token) throw new Error('尚未登入');
  return waitForDeploy(token, sha);
});

// ---------- published-content management (list / read / delete) ----------
ipcMain.handle('content:list', async () => {
  const token = gh.loadToken();
  if (!token) throw new Error('尚未登入');
  return listContent(token);
});

ipcMain.handle('content:getText', async (_e, path: string) => {
  const token = gh.loadToken();
  if (!token) throw new Error('尚未登入');
  return getContentText(token, path);
});

ipcMain.handle('content:getBinary', async (_e, path: string) => {
  const token = gh.loadToken();
  if (!token) throw new Error('尚未登入');
  return getContentBase64(token, path);
});

ipcMain.handle(
  'content:delete',
  async (_e, item: { kind: 'post' | 'work'; path: string; title: string }) => {
    const token = gh.loadToken();
    if (!token) throw new Error('尚未登入');
    await deleteContent(token, item);
    return true;
  },
);

ipcMain.handle('trash:list', async () => {
  const token = gh.loadToken();
  if (!token) throw new Error('尚未登入');
  return listTrash(token);
});

ipcMain.handle(
  'trash:restore',
  async (_e, item: { title: string; parent: string; files: string[] }) => {
    const token = gh.loadToken();
    if (!token) throw new Error('尚未登入');
    await restoreContent(token, item);
    return true;
  },
);

// ---------- lifecycle ----------
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
