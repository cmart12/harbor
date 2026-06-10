import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorState } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { $prose } from '@milkdown/kit/utils';
import type { CanvasThreadAgentStatus, CommentThread } from '../../types';
import { flattenDoc, resolveThreadRange } from '../anchor';

export const commentPluginKey = new PluginKey('whim-comments');

export interface CommentRange {
  threadId: string;
  from: number;
  to: number;
  resolved: boolean;
}

export interface CommentPluginState {
  threads: CommentThread[];
  agentStatuses: CanvasThreadAgentStatus[];
  ranges: CommentRange[];
  activeId: string | null;
  set: DecorationSet;
}

export const SET_THREADS = 'whim-set-threads';
export const SET_ACTIVE = 'whim-set-active';
export const SET_AGENT_THREAD_STATUSES = 'whim-set-agent-thread-statuses';

function resolveRanges(doc: ProseNode, threads: CommentThread[]): CommentRange[] {
  if (threads.length === 0) return [];
  const flat = flattenDoc(doc);
  const ranges: CommentRange[] = [];
  for (const t of threads) {
    const r = resolveThreadRange(doc, t, flat);
    if (r) ranges.push({ threadId: t.id, from: r.from, to: r.to, resolved: !!t.resolvedAt });
  }
  return ranges;
}

function buildSet(
  doc: ProseNode,
  ranges: CommentRange[],
  activeId: string | null,
  agentStatuses: CanvasThreadAgentStatus[],
): DecorationSet {
  if (ranges.length === 0) return DecorationSet.empty;
  const statusByThread = new Map(agentStatuses.map(s => [s.threadId, s.status]));
  const decos = ranges.map((r) => {
    const classes = ['whim-comment'];
    if (r.resolved) classes.push('whim-comment-resolved');
    if (r.threadId === activeId) classes.push('whim-comment-active');
    const agentStatus = statusByThread.get(r.threadId);
    if (agentStatus) {
      classes.push('whim-comment-agent', `whim-comment-agent-${agentStatus}`);
    }
    return Decoration.inline(
      r.from,
      r.to,
      { class: classes.join(' '), 'data-thread-id': r.threadId },
      { inclusiveStart: false, inclusiveEnd: false },
    );
  });
  return DecorationSet.create(doc, decos);
}

/** Find the topmost comment thread whose range contains `pos`. */
export function commentThreadAt(state: EditorState, pos: number): CommentRange | null {
  const pstate = commentPluginKey.getState(state) as CommentPluginState | undefined;
  if (!pstate) return null;
  let best: CommentRange | null = null;
  for (const r of pstate.ranges) {
    if (pos >= r.from && pos <= r.to) {
      if (!best || r.to - r.from < best.to - best.from) best = r;
    }
  }
  return best;
}

export function getCommentState(state: EditorState): CommentPluginState | undefined {
  return commentPluginKey.getState(state) as CommentPluginState | undefined;
}

/** ProseMirror plugin: render comment-thread highlights from host thread data. */
export const commentPlugin = $prose(() => {
  return new Plugin<CommentPluginState>({
    key: commentPluginKey,
    state: {
      init: (_config, _state) => ({
        threads: [],
        agentStatuses: [],
        ranges: [],
        activeId: null,
        set: DecorationSet.empty,
      }),
      apply(tr, value, _oldState, newState): CommentPluginState {
        const setThreads = tr.getMeta(SET_THREADS) as CommentThread[] | undefined;
        const activeMeta = tr.getMeta(SET_ACTIVE) as { id: string | null } | undefined;
        const agentStatusMeta = tr.getMeta(SET_AGENT_THREAD_STATUSES) as CanvasThreadAgentStatus[] | undefined;

        if (setThreads) {
          const ranges = resolveRanges(newState.doc, setThreads);
          return {
            threads: setThreads,
            agentStatuses: value.agentStatuses,
            ranges,
            activeId: value.activeId,
            set: buildSet(newState.doc, ranges, value.activeId, value.agentStatuses),
          };
        }

        if (activeMeta) {
          return {
            ...value,
            activeId: activeMeta.id,
            set: buildSet(newState.doc, value.ranges, activeMeta.id, value.agentStatuses),
          };
        }

        if (agentStatusMeta) {
          return {
            ...value,
            agentStatuses: agentStatusMeta,
            set: buildSet(newState.doc, value.ranges, value.activeId, agentStatusMeta),
          };
        }

        if (tr.docChanged && value.threads.length > 0) {
          const ranges = resolveRanges(newState.doc, value.threads);
          return {
            ...value,
            ranges,
            set: buildSet(newState.doc, ranges, value.activeId, value.agentStatuses),
          };
        }

        return value;
      },
    },
    props: {
      decorations(state) {
        return (commentPluginKey.getState(state) as CommentPluginState | undefined)?.set ?? DecorationSet.empty;
      },
    },
  });
});
