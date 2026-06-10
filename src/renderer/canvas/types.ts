// Local canvas editor types. These replace the types previously imported from
// `@patniko/documint`. They are intentionally framework-agnostic so the rest of
// the app (app.ts, mount.tsx) depends on the canvas contract, not on the editor
// implementation underneath (now Milkdown / ProseMirror).

export const ANCHOR_KINDS = ['text', 'code', 'tableCell'] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];

/**
 * Content-addressable anchor: identifies a span of text by the quote plus a
 * little surrounding context, so it can self-repair after edits without storing
 * absolute offsets.
 */
export type TextAnchor = {
  kind?: AnchorKind;
  prefix?: string;
  suffix?: string;
};

export type CommentThreadAnchor = {
  threadId: string;
};

export type Anchor = TextAnchor | CommentThreadAnchor;

export type Comment = {
  body: string;
  updatedAt: string;
};

export type CommentThread = {
  id: string;
  quote: string;
  comments: Comment[];
  anchor: TextAnchor;
  resolvedAt?: string;
};

/**
 * A user known to the host. The full set is the mention roster; the subset that
 * also appears in `presence` shows a live cursor in the document.
 */
export type CanvasUser = {
  id: string;
  username: string;
  fullName?: string;
  avatarUrl?: string;
};

/**
 * One user's live document presence. `userId` foreign-keys into the `users`
 * roster; entries without a matching user are dropped. `cursor` is either a
 * content-addressable text anchor or a comment-thread anchor.
 */
export type CanvasPresence = {
  userId: string;
  cursor?: Anchor;
  color?: string;
  status?: string;
};

export type CanvasThreadAgentStatus = {
  threadId: string;
  agentId: string;
  status: 'starting' | 'active' | 'waiting' | 'completed' | 'failed';
  label: string;
};

export type CanvasAgentInteraction =
  | {
      kind: 'approval';
      agentId: string;
      requestId: string;
      permissionKind: string;
      intention?: string;
      path?: string;
      responded?: boolean;
      approved?: boolean;
    }
  | {
      kind: 'user_input';
      agentId: string;
      requestId: string;
      question: string;
      choices?: string[];
      allowFreeform?: boolean;
      responded?: boolean;
      answer?: string;
      wasFreeform?: boolean;
    }
  | {
      kind: 'elicitation';
      agentId: string;
      requestId: string;
      message: string;
      requestedSchema?: any;
      mode?: 'form' | 'url';
      elicitationSource?: string;
      responded?: boolean;
      action?: 'accept' | 'decline' | 'cancel';
      content?: Record<string, any>;
    }
  | {
      kind: 'sandbox_block';
      agentId: string;
      requestId: string;
      source: 'permission' | 'pre-tool' | 'post-tool-shell';
      blockKind: 'read' | 'write' | 'shell' | 'mcp' | 'url' | 'web-fetch';
      toolName?: string;
      target: string;
      intention?: string;
      allowedDecisions?: Array<'allow-once' | 'allow-for-session' | 'disable'>;
      layer?: string;
      personaHandle?: string;
      responded?: boolean;
      decision?: 'allow-once' | 'allow-for-session' | 'disable';
    };

/** Host-provided regex highlight. Not serialized back to markdown. */
export type CanvasDecoration = {
  backgroundColor?: string;
  pulse?: boolean;
  color?: string;
  pattern: RegExp;
};

export type UserMentionEvent = {
  lineMarkdown: string;
  lineNumber: number;
  userId: string;
};

export type CommentChange =
  | {
      kind: 'added';
      comment: Comment;
      mentionedUserIds: string[];
      thread: CommentThread;
      threadId: string;
    }
  | {
      kind: 'edited';
      comment: Comment;
      previousBody: string;
      mentionedUserIds: string[];
      thread: CommentThread;
      threadId: string;
    }
  | {
      kind: 'deleted';
      comment: Comment;
      thread: CommentThread;
      threadId: string;
    };

export type CommentTrigger = 'hover-or-caret' | 'caret';

/** A reference to a custom-protocol resource link discovered in the document. */
export type DocumentResourceReference = {
  protocol: string;
  url: string;
};
