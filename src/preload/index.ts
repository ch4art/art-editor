import { contextBridge, ipcRenderer, webUtils } from 'electron';

type LoginCode = { user_code: string; verification_uri: string };

// The bridge between the UI (renderer) and Node/Electron (main).
type BlogPostInput = {
  title: string;
  description: string;
  date: string;
  tags: string[];
  body: string;
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
      data: BlogPostInput & { models?: { filename: string; base64: string }[] },
    ): Promise<{ slug: string; path: string; url: string }> =>
      ipcRenderer.invoke('publish:post', data),
    work: (data: {
      title: string;
      description: string;
      environment: string;
      tags: string[];
      body: string;
      modelFilename: string;
      modelBase64: string;
      gifBase64: string;
    }): Promise<{ slug: string; url: string }> => ipcRenderer.invoke('publish:work', data),
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
