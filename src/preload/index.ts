import { contextBridge, ipcRenderer, webUtils } from 'electron';

type LoginCode = { user_code: string; verification_uri: string };

// The bridge between the UI (renderer) and Node/Electron (main).
type BlogPostInput = {
  title: string;
  description: string;
  date: string;
  tags: string[];
  body: string;
  private?: boolean;
  cipher?: string;
};

const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('app:openExternal', url),

  /** Absolute path of a File picked via <input type=file> (Electron). */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  /** Crush a big .glb in the main process via gltfpack (handles GB-scale). */
  optimizeBigModel: (
    path: string,
    opts: { simplifyRatio?: number },
  ): Promise<{ base64: string; before: number; after: number }> =>
    ipcRenderer.invoke('model:optimizeBig', path, opts),

  publish: {
    post: (
      data: BlogPostInput & {
        models?: { filename: string; base64: string }[];
        images?: { filename: string; base64: string }[];
        encImages?: { path: string; base64: string }[];
        existingPath?: string;
      },
    ): Promise<{ slug: string; path: string; sha: string; url: string }> =>
      ipcRenderer.invoke('publish:post', data),
    work: (data: {
      title: string;
      description: string;
      environment: string;
      tags: string[];
      body: string;
      modelFilename?: string;
      modelBase64?: string;
      gifBase64?: string;
      existingSlug?: string;
      keepAssets?: boolean;
      order?: number;
    }): Promise<{ slug: string; sha: string; url: string }> =>
      ipcRenderer.invoke('publish:work', data),
    drawing: (data: {
      title: string;
      alt: string;
      description: string;
      tags: string[];
      featured: boolean;
      date?: string;
      imageBase64?: string;
      imageExt?: string;
      existingSlug?: string;
      existingImage?: string;
    }): Promise<{ slug: string; sha: string; url: string }> =>
      ipcRenderer.invoke('publish:drawing', data),
    /** Resolves once the Pages deploy for this commit finishes (site live). */
    waitLive: (sha: string): Promise<{ ok: boolean; state: string }> =>
      ipcRenderer.invoke('publish:waitLive', sha),
  },

  /** Published content on GitHub: list, read, delete (for the manage tab). */
  content: {
    list: (): Promise<
      { kind: 'post' | 'work' | 'drawing'; path: string; name: string; slug: string; title: string }[]
    > => ipcRenderer.invoke('content:list'),
    getText: (path: string): Promise<string> => ipcRenderer.invoke('content:getText', path),
    getBinary: (path: string): Promise<string> => ipcRenderer.invoke('content:getBinary', path),
    remove: (item: { kind: 'post' | 'work' | 'drawing'; path: string; title: string }): Promise<boolean> =>
      ipcRenderer.invoke('content:delete', item),
    /** 資源回收桶:刪掉的內容(藏在 git 歷史裡)+ 一鍵還原。 */
    trashList: (): Promise<
      {
        kind: 'post' | 'work' | 'drawing';
        title: string;
        date: string;
        parent: string;
        files: string[];
        key: string;
      }[]
    > => ipcRenderer.invoke('trash:list'),
    restore: (item: { title: string; parent: string; files: string[] }): Promise<boolean> =>
      ipcRenderer.invoke('trash:restore', item),
  },

  update: {
    /** 檢查 GitHub 上有沒有新版本(公開 repo,免登入)。 */
    check: (): Promise<{ hasUpdate: boolean; version: string; current: string; url?: string }> =>
      ipcRenderer.invoke('update:check'),
    /** 下載新版並交給背景程式換檔重開。 */
    apply: (url: string): Promise<boolean> => ipcRenderer.invoke('update:apply', url),
    /** 下載進度 0–100。回傳取消訂閱函式。 */
    onProgress: (cb: (pct: number) => void): (() => void) => {
      const listener = (_e: unknown, pct: number): void => cb(pct);
      ipcRenderer.on('update:progress', listener);
      return () => ipcRenderer.removeListener('update:progress', listener);
    },
  },

  github: {
    status: (): Promise<{ loggedIn: boolean; login?: string }> =>
      ipcRenderer.invoke('github:status'),
    /** Starts device-flow login; resolves with the username once authorized. */
    login: (): Promise<{ login: string }> => ipcRenderer.invoke('github:login'),
    logout: (): Promise<boolean> => ipcRenderer.invoke('github:logout'),
    /** Fires once the device code to show the user is ready. Returns an unsubscribe fn. */
    onCode: (cb: (code: LoginCode) => void): (() => void) => {
      const listener = (_e: unknown, data: LoginCode): void => cb(data);
      ipcRenderer.on('github:code', listener);
      return () => ipcRenderer.removeListener('github:code', listener);
    },
  },
};

export type EditorApi = typeof api;

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api);
} else {
  // @ts-expect-error — fallback when context isolation is off
  window.api = api;
}
