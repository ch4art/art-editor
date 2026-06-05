import type { EditorApi } from './index';

declare global {
  interface Window {
    api: EditorApi;
  }
}
