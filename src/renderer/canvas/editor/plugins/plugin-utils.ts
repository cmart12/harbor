/**
 * Run a ProseMirror plugin `apply` body with error isolation.
 *
 * Canvas plugins (host decorations, comment highlights, agent presence) rebuild their
 * DecorationSet from *host/agent-provided* data inside the transaction pipeline. A single
 * throw there — a malformed anchor, an unexpected position, a bad regex — propagates out of
 * `EditorState.apply` and breaks the entire editor: text entry, the selection toolbar,
 * typing effects, and autosave all stop. These overlays are presentation-only, so on error
 * we keep the previous plugin state and let the editor carry on instead of bricking it.
 */
export function safePluginApply<T>(where: string, fallback: T, compute: () => T): T {
  try {
    return compute();
  } catch (err) {
    console.error(`[canvas editor] ${where} plugin apply failed:`, err);
    return fallback;
  }
}
