import { ElicitationContext, ElicitationResult } from '@github/copilot-sdk';
import type { PermissionRequest } from '@github/copilot-sdk';
import * as crypto from 'crypto';
import type { AgentNotifier } from './agent-notifier';
import type { AgentPersistence } from './agent-persistence';
import type { AgentRecord } from './agent-registry';

// UserInputRequest/UserInputResponse are not re-exported from the SDK index,
// so we define compatible interfaces here.
interface UserInputRequest {
  question: string;
  choices?: string[];
  allowFreeform?: boolean;
}

interface UserInputResponse {
  answer: string;
  wasFreeform: boolean;
}

export class InteractionBroker {
  private approvalCallbacks = new Map<string, (approved: boolean) => void>();
  private userInputCallbacks = new Map<string, (response: UserInputResponse) => void>();
  private elicitationCallbacks = new Map<string, (result: ElicitationResult) => void>();

  constructor(
    private notifier: AgentNotifier,
    private persistence: AgentPersistence,
  ) {}

  /**
   * Permission handler for sandboxed agents.
   * Auto-approves reads, auto-denies writes. Shell permissions are handled
   * by the pre-tool hook (read-only classification). MCP and other kinds
   * fall through to the normal interactive handler.
   */
  createSandboxedPermissionHandler(findRecord: (sessionId: string) => AgentRecord | undefined) {
    return async (request: PermissionRequest, invocation: { sessionId: string }) => {
      if (request.kind === 'read') return { kind: 'approve-once' as const };
      if (request.kind === 'write') return { kind: 'reject' as const };
      // For shell, mcp, url, and other kinds, fall through to normal handler
      return this.createPermissionHandler(findRecord)(request, invocation);
    };
  }

  /**
   * Shared permission request handler for all agent types.
   * Each concurrent request gets a unique requestId so callbacks never overwrite each other.
   */
  createPermissionHandler(findRecord: (sessionId: string) => AgentRecord | undefined) {
    return async (request: PermissionRequest, invocation: { sessionId: string }) => {
      const record = findRecord(invocation.sessionId);
      if (!record) return { kind: 'reject' as const };

      // Auto-approve read operations (view, grep, glob, etc.)
      if (request.kind === 'read') return { kind: 'approve-once' as const };

      const requestId = request.toolCallId ?? crypto.randomUUID();
      // Extract rich context from the SDK permission request
      const req = request as unknown as Record<string, unknown>;
      const intention = typeof req.intention === 'string' ? req.intention : undefined;
      const path = typeof req.path === 'string' ? req.path
        : typeof req.fileName === 'string' ? req.fileName
        : undefined;

      console.log(`[InteractionBroker] Permission requested: kind=${request.kind} requestId=${requestId} agent=${record.agentId}`);

      record.status = 'waiting-approval';
      record.pendingApprovalId = requestId;
      record.pendingPermissionKind = request.kind || null;
      record.pendingApprovals.set(requestId, { permissionKind: request.kind || null, intention, path });
      this.persistence.updateStatus(record);

      this.notifier.notifyRenderer('agent:approval-needed', {
        agentId: record.agentId,
        requestId,
        permissionKind: request.kind,
        intention,
        path,
      });

      this.notifier.notifyRenderer(`chat:event:${record.agentId}`, {
        type: 'approval.needed',
        requestId,
        agentId: record.agentId,
        permissionKind: request.kind,
        intention,
        path,
      });

      this.notifier.showApprovalNotification({
        agentId: record.agentId,
        requestId,
        permissionKind: request.kind || 'permission',
        intention,
        path,
        onApprove: () => this.approveAgent(record.agentId, requestId, true),
        onDeny: () => this.approveAgent(record.agentId, requestId, false),
      });

      return new Promise<{ kind: 'approve-once' } | { kind: 'reject' }>((resolve) => {
        this.approvalCallbacks.set(requestId, (approved: boolean) => {
          record.pendingApprovals.delete(requestId);
          if (record.pendingApprovals.size === 0) {
            record.pendingApprovalId = null;
            record.pendingPermissionKind = null;
            record.status = 'running';
          } else {
            // Update to reflect the next pending approval
            const [nextId, next] = [...record.pendingApprovals.entries()][0];
            record.pendingApprovalId = nextId;
            record.pendingPermissionKind = next.permissionKind;
          }
          this.persistence.updateStatus(record);
          const result = approved
            ? { kind: 'approve-once' as const }
            : { kind: 'reject' as const };
          console.log(`[InteractionBroker] Permission resolved: requestId=${requestId} result=${result.kind}`);
          resolve(result);
        });
      });
    };
  }

  createUserInputHandler(findRecord: (sessionId: string) => AgentRecord | undefined) {
    return async (request: UserInputRequest, invocation: { sessionId: string }): Promise<UserInputResponse> => {
      const record = findRecord(invocation.sessionId);
      if (!record) return { answer: '', wasFreeform: true };

      const requestId = crypto.randomUUID();

      this.notifier.notifyRenderer(`chat:event:${record.agentId}`, {
        type: 'user_input.requested',
        requestId,
        agentId: record.agentId,
        question: request.question,
        choices: request.choices,
        allowFreeform: request.allowFreeform,
      });

      this.notifier.showApprovalNotification({
        agentId: record.agentId,
        requestId,
        permissionKind: 'question',
      });

      return new Promise<UserInputResponse>((resolve) => {
        this.userInputCallbacks.set(requestId, resolve);
      });
    };
  }

  createElicitationHandler(findRecord: (sessionId: string) => AgentRecord | undefined) {
    return async (context: ElicitationContext): Promise<ElicitationResult> => {
      const record = findRecord(context.sessionId);
      if (!record) return { action: 'cancel' };

      const requestId = crypto.randomUUID();

      this.notifier.notifyRenderer(`chat:event:${record.agentId}`, {
        type: 'elicitation.requested',
        requestId,
        agentId: record.agentId,
        message: context.message,
        requestedSchema: context.requestedSchema,
        mode: context.mode,
        elicitationSource: context.elicitationSource,
      });

      this.notifier.showApprovalNotification({
        agentId: record.agentId,
        requestId,
        permissionKind: 'input needed',
      });

      return new Promise<ElicitationResult>((resolve) => {
        this.elicitationCallbacks.set(requestId, resolve);
      });
    };
  }

  approveAgent(agentId: string, requestId: string, approved: boolean): void {
    const cb = this.approvalCallbacks.get(requestId);
    if (cb) {
      this.approvalCallbacks.delete(requestId);
      cb(approved);
    } else {
      console.warn(`[InteractionBroker] No approval callback for requestId=${requestId} (agentId=${agentId}, approved=${approved})`);
    }
    // Notify chat channel so both workers list and chat view stay in sync
    this.notifier.notifyRenderer(`chat:event:${agentId}`, {
      type: 'approval.resolved',
      requestId,
      approved,
    });
  }

  respondToUserInput(agentId: string, requestId: string, answer: string, wasFreeform: boolean): void {
    const cb = this.userInputCallbacks.get(requestId);
    if (cb) {
      this.userInputCallbacks.delete(requestId);
      cb({ answer, wasFreeform });
    }
    this.notifier.notifyRenderer(`chat:event:${agentId}`, {
      type: 'user_input.resolved',
      requestId,
      answer,
      wasFreeform,
    });
  }

  respondToElicitation(agentId: string, requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>): void {
    const cb = this.elicitationCallbacks.get(requestId);
    if (cb) {
      this.elicitationCallbacks.delete(requestId);
      cb({ action, content: content as ElicitationResult['content'] });
    }
    this.notifier.notifyRenderer(`chat:event:${agentId}`, {
      type: 'elicitation.resolved',
      requestId,
      action,
      content,
    });
  }

  /** Deny and clean up all pending approval callbacks for a given agent. */
  clearPendingApprovals(record: AgentRecord): void {
    for (const requestId of record.pendingApprovals.keys()) {
      const cb = this.approvalCallbacks.get(requestId);
      if (cb) {
        this.approvalCallbacks.delete(requestId);
        cb(false);
      }
    }
    record.pendingApprovals.clear();
    record.pendingApprovalId = null;
    record.pendingPermissionKind = null;
  }

  /** Cancel all pending interactive requests (user input + elicitation) for a given agent. */
  clearPendingInteractions(record: AgentRecord): void {
    this.clearPendingApprovals(record);

    // Cancel any pending user-input callbacks
    for (const [requestId, cb] of this.userInputCallbacks.entries()) {
      // We can't easily filter by agent, so we resolve with empty answer.
      // In practice the session abort will handle cleanup, but this prevents leaks.
      cb({ answer: '', wasFreeform: true });
      this.userInputCallbacks.delete(requestId);
    }

    // Cancel any pending elicitation callbacks
    for (const [requestId, cb] of this.elicitationCallbacks.entries()) {
      cb({ action: 'cancel' });
      this.elicitationCallbacks.delete(requestId);
    }
  }
}
