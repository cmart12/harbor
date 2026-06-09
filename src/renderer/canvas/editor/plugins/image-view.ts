import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import type { EditorView, NodeView } from '@milkdown/kit/prose/view';

export type ImageSrcResolver = (src: string) => Promise<string | null>;

const ABSOLUTE_SRC = /^(https?:|data:|blob:|whim:)/i;

/**
 * Custom node view for markdown images. Absolute/data/blob URLs render directly;
 * workspace-relative paths (e.g. `attachments/foo.png`) are resolved through the
 * host storage bridge into object URLs so on-disk attachments display — the role
 * documint's `storage.readFile` used to serve.
 */
export function createImageNodeView(resolverRef: { current?: ImageSrcResolver }) {
  return (node: ProseNode): NodeView => {
    const dom = document.createElement('img');
    dom.className = 'milkdown-image';
    let objectUrl: string | null = null;

    const apply = (n: ProseNode) => {
      const src = String(n.attrs.src ?? '');
      dom.alt = String(n.attrs.alt ?? '');
      if (n.attrs.title) dom.title = String(n.attrs.title);
      if (!src) return;
      if (ABSOLUTE_SRC.test(src)) {
        dom.src = src;
        return;
      }
      const resolver = resolverRef.current;
      if (!resolver) return;
      resolver(src)
        .then((url) => {
          if (!url) return;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = url.startsWith('blob:') ? url : null;
          dom.src = url;
        })
        .catch(() => { /* leave broken image */ });
    };

    apply(node);

    return {
      dom,
      update: (updated: ProseNode) => {
        if (updated.type.name !== node.type.name) return false;
        apply(updated);
        return true;
      },
      destroy: () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      },
    };
  };
}

export interface ImageUploader {
  (file: File): Promise<{ src: string } | null>;
}

/**
 * A `handlePaste` handler that intercepts clipboard image files, persists them
 * through the host uploader, and inserts image nodes at the caret.
 */
export function createImagePasteHandler(uploaderRef: { current?: ImageUploader }) {
  return (view: EditorView, event: ClipboardEvent): boolean => {
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) return false;
    const images = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return false;
    const uploader = uploaderRef.current;
    if (!uploader) return false;

    event.preventDefault();
    void (async () => {
      for (const file of images) {
        try {
          const res = await uploader(file);
          if (!res?.src) continue;
          const imageType = view.state.schema.nodes.image;
          if (!imageType) continue;
          const node = imageType.createAndFill({ src: res.src, alt: file.name });
          if (node) view.dispatch(view.state.tr.replaceSelectionWith(node).scrollIntoView());
        } catch {
          /* ignore individual paste failures */
        }
      }
    })();
    return true;
  };
}
