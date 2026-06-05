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
import { commitFiles } from './publish';
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
  async (_e, post: BlogPostInput & { models?: { filename: string; base64: string }[] }) => {
    const token = gh.loadToken();
    if (!token) throw new Error('尚未登入');
    const { slug, mdx } = buildBlogPost(post);
    const path = `src/content/blog/${slug}.mdx`;
    const files: { path: string; content: string; encoding: 'utf-8' | 'base64' }[] = [
      { path, content: mdx, encoding: 'utf-8' },
    ];
    for (const m of post.models ?? []) {
      files.push({ path: `public/models/${m.filename}`, content: m.base64, encoding: 'base64' });
    }
    await commitFiles(token, files, `文章:${post.title}`);
    return { slug, path, url: `https://${gh.REPO.owner}.github.io/blog/${slug}/` };
  },
);

ipcMain.handle(
  'publish:work',
  async (
    _e,
    work: WorkInput & { modelFilename: string; modelBase64: string; gifBase64: string },
  ) => {
    const token = gh.loadToken();
    if (!token) throw new Error('尚未登入');
    const slug = sanitizeSlug(work.modelFilename);
    const md = buildWork(work, slug);
    await commitFiles(
      token,
      [
        { path: `public/models/${slug}.glb`, content: work.modelBase64, encoding: 'base64' },
        { path: `public/works/${slug}.gif`, content: work.gifBase64, encoding: 'base64' },
        { path: `src/content/works/${slug}.md`, content: md, encoding: 'utf-8' },
      ],
      `作品:${work.title}`,
    );
    return { slug, url: `https://${gh.REPO.owner}.github.io/portfolio/${slug}/` };
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
