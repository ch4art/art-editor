// The WYSIWYG writing surface: you type directly into a page that looks like
// the published article (same pv-* styles as the site). Under the hood it is
// TipTap (ProseMirror) and the document round-trips to Markdown with the
// friendly "<<3D模型: file.glb>>" tokens — so publish/draft/edit flows are
// unchanged and the user never sees Markdown or JSX.
import { createContext, forwardRef, useContext, useImperativeHandle, useState } from 'react';
import {
  useEditor,
  EditorContent,
  ReactNodeViewRenderer,
  NodeViewWrapper,
  type NodeViewProps,
} from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Node } from '@tiptap/core';
import { Markdown } from 'tiptap-markdown';

/** Blob URLs for attached assets, keyed by filename. */
export type Assets = {
  modelGifs: Record<string, string>; // glb filename → rotating-GIF blob URL
  imageUrls: Record<string, string>; // image filename → blob URL
};

const AssetCtx = createContext<Assets>({ modelGifs: {}, imageUrls: {} });

const TOKEN_RE = /<<3D模型:\s*([^>]+?)\s*>>/g;

/** Friendly tokens → a custom tag markdown-it (html:true) passes through.
 *  Shape matters (both verified empirically):
 *  - the OPEN tag must sit alone on its own line with blank lines around it,
 *    or markdown-it's html_block rule 7 won't fire (tokens mid-paragraph
 *    would become inline HTML inside a <p>);
 *  - the tag must be EXPLICITLY CLOSED on a following line — HTML parsing
 *    ignores the "/" in <model-block />, so a self-closing form is an
 *    unclosed tag that swallows (and then drops) all following content.
 *  Known limit: a model block dragged inside a list/quote pops back out to
 *  top level on reload — content is kept, only the position normalizes. */
function tokensToHtml(md: string): string {
  return md.replace(
    TOKEN_RE,
    (_m, f) =>
      `\n\n<model-block data-file="${String(f).trim().replace(/["<>]/g, '')}">\n</model-block>\n\n`,
  );
}

// ---------- 3D model block (atom node, shows the rotating GIF) ----------
function ModelBlockView({ node, deleteNode }: NodeViewProps) {
  const { modelGifs } = useContext(AssetCtx);
  const file = String(node.attrs.file || '');
  const gif = modelGifs[file];
  return (
    <NodeViewWrapper className={gif ? 'pv-model' : 'pv-model pv-model-empty'} data-drag-handle>
      <button
        type="button"
        className="nv-del"
        contentEditable={false}
        title="刪除這個 3D 模型"
        onClick={deleteNode}
      >
        ✕
      </button>
      {gif ? (
        <>
          <img src={gif} alt={file} width={220} height={220} draggable={false} />
          <span>🧊 3D 模型(在網站上可以旋轉、縮放)</span>
        </>
      ) : (
        <>🧊 3D 模型:{file}</>
      )}
    </NodeViewWrapper>
  );
}

const ModelBlock = Node.create({
  name: 'modelBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { file: { default: '' } };
  },
  parseHTML() {
    return [
      {
        tag: 'model-block',
        getAttrs: (el) => ({ file: (el as HTMLElement).getAttribute('data-file') || '' }),
      },
    ];
  },
  renderHTML({ node }) {
    return ['model-block', { 'data-file': node.attrs.file }];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ModelBlockView);
  },
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write(`<<3D模型: ${node.attrs.file}>>`);
          state.closeBlock(node);
        },
      },
    };
  },
});

// ---------- images (src stays ./images/<name>, display resolves to blob) ----------
function ImageView({ node, deleteNode }: NodeViewProps) {
  const { imageUrls } = useContext(AssetCtx);
  const src = String(node.attrs.src || '');
  const name = src.startsWith('./images/') ? src.slice('./images/'.length) : '';
  const url = (name && imageUrls[name]) || src;
  return (
    <NodeViewWrapper className="pv-imgwrap" data-drag-handle>
      <button
        type="button"
        className="nv-del"
        contentEditable={false}
        title="刪除這張圖片"
        onClick={deleteNode}
      >
        ✕
      </button>
      <img src={url} alt={String(node.attrs.alt || '')} draggable={false} />
    </NodeViewWrapper>
  );
}

const SiteImage = Image.extend({
  draggable: true,
  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          // Only the post's own images. External/Word-pasted images would
          // publish as broken or hotlinked files, so they are dropped.
          const src = (el as HTMLElement).getAttribute('src') || '';
          if (!src.startsWith('./images/')) return false;
          return {
            src,
            alt: (el as HTMLElement).getAttribute('alt'),
            title: (el as HTMLElement).getAttribute('title'),
          };
        },
      },
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageView);
  },
  addStorage() {
    return {
      markdown: {
        // The stock image spec was written for INLINE images and never calls
        // closeBlock — with a block-level image the next block would be glued
        // onto the same line (corrupting headings/lists/tokens). Verified.
        serialize(state: any, node: any) {
          const alt = state.esc(String(node.attrs.alt || ''));
          const src = String(node.attrs.src || '').replace(/[()]/g, '\\$&');
          state.write(`![${alt}](${src})`);
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});

// ---------- links (always serialize as [text](url) — the <autolink> form
// markdown emits for bare URLs is a fatal MDX compile error on the site) ----------
const SafeLink = Link.extend({
  addStorage() {
    return {
      markdown: {
        serialize: {
          open: '[',
          close(_state: any, mark: any) {
            const href = String(mark.attrs.href || '').replace(/[()"]/g, '\\$&');
            return `](${href})`;
          },
          mixable: true,
        },
        parse: {},
      },
    };
  },
});

// ---------- toolbar button (module-level so buttons don't remount per keystroke) ----------
function TB({
  on,
  act,
  label,
  title,
}: {
  on?: boolean;
  act: () => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={on ? 'tb on' : 'tb'}
      title={title}
      onMouseDown={(e) => e.preventDefault()} // keep the editor focused
      onClick={act}
    >
      {label}
    </button>
  );
}

// ---------- the editor ----------
export type RichEditorHandle = {
  /** Insert an image node at the cursor (src like ./images/<name>). */
  insertImage: (src: string, alt?: string) => void;
  /** Insert a 3D model block at the cursor. */
  insertModel: (file: string) => void;
};

const RichEditor = forwardRef<
  RichEditorHandle,
  {
    initialMarkdown: string;
    assets: Assets;
    onMarkdownChange: (md: string) => void;
    /** Pasted or dropped image files (may be several at once). */
    onAddImages?: (files: File[]) => void;
    /** A .glb dropped straight onto the page. */
    onDropModel?: (file: File) => void;
    /** Site-styled, non-editable header (title/date/tags) above the body. */
    header?: React.ReactNode;
    /** Extra toolbar buttons (insert image / insert 3D model). */
    extraButtons?: React.ReactNode;
  }
>(function RichEditor(
  { initialMarkdown, assets, onMarkdownChange, onAddImages, onDropModel, header, extraButtons },
  ref,
) {
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      SiteImage,
      SafeLink.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: '開始打字,這裡看到的就是發布後的樣子…' }),
      ModelBlock,
      Markdown.configure({ html: true, tightLists: true, transformPastedText: true }),
    ],
    content: tokensToHtml(initialMarkdown || ''),
    editorProps: {
      attributes: { class: 'pv-body editing' },
      handlePaste(_view, event) {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith('image/'),
        );
        if (files.length && onAddImages) {
          event.preventDefault();
          onAddImages(files);
          return true;
        }
        return false;
      },
      handleDrop(_view, event) {
        const all = Array.from(event.dataTransfer?.files ?? []);
        if (!all.length) return false;
        // Never let Chromium navigate to a dropped file.
        event.preventDefault();
        const imgs = all.filter((f) => f.type.startsWith('image/'));
        const glbs = all.filter((f) => /\.glb$/i.test(f.name));
        if (imgs.length) onAddImages?.(imgs);
        for (const g of glbs) onDropModel?.(g);
        return true;
      },
    },
    onUpdate({ editor }) {
      onMarkdownChange(editor.storage.markdown.getMarkdown());
    },
  });

  useImperativeHandle(
    ref,
    () => ({
      insertImage(src, alt = '圖片') {
        editor?.chain().focus().setImage({ src, alt }).run();
      },
      insertModel(file) {
        editor
          ?.chain()
          .focus()
          .insertContent({ type: 'modelBlock', attrs: { file } })
          .run();
      },
    }),
    [editor],
  );

  function applyLink() {
    let url = linkUrl.trim();
    setLinkOpen(false);
    setLinkUrl('');
    if (!url || !editor) return;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    if (editor.state.selection.empty) {
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] })
        .run();
    } else {
      editor.chain().focus().setLink({ href: url }).run();
    }
  }

  return (
    <div className="richwrap">
      {/* 直欄工具列,貼著打字區左邊、跟著捲動 */}
      <div className="toolbar rail">
        <TB
          on={editor?.isActive('bold')}
          act={() => editor?.chain().focus().toggleBold().run()}
          label="粗體"
          title="Ctrl+B"
        />
        <TB
          on={editor?.isActive('italic')}
          act={() => editor?.chain().focus().toggleItalic().run()}
          label="斜體"
          title="Ctrl+I"
        />
        <TB
          on={editor?.isActive('heading', { level: 2 })}
          act={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          label="標題"
        />
        <TB
          on={editor?.isActive('bulletList')}
          act={() => editor?.chain().focus().toggleBulletList().run()}
          label="清單"
        />
        <TB
          on={editor?.isActive('blockquote')}
          act={() => editor?.chain().focus().toggleBlockquote().run()}
          label="引用"
        />
        <TB
          on={editor?.isActive('link') || linkOpen}
          act={() => {
            if (editor?.isActive('link')) editor.chain().focus().unsetLink().run();
            else setLinkOpen((v) => !v);
          }}
          label="🔗 連結"
          title="選一段字再按,或直接貼網址"
        />
        {extraButtons}
      </div>
      <div className="surfacecol">
        {linkOpen && (
          <div className="linkbox">
            <input
              autoFocus
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyLink();
                if (e.key === 'Escape') {
                  setLinkOpen(false);
                  setLinkUrl('');
                }
              }}
              placeholder="貼上網址,例如 example.com"
            />
            <button type="button" className="tb" onClick={applyLink}>
              加上連結
            </button>
          </div>
        )}
        <div className="editor-surface">
          <AssetCtx.Provider value={assets}>
            {header}
            <EditorContent editor={editor} />
          </AssetCtx.Provider>
        </div>
      </div>
    </div>
  );
});

export default RichEditor;
