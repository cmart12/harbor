import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InteractionBroker } from './interaction-broker';
import type { AgentNotifier } from './agent-notifier';
import type { AgentPersistence } from './agent-persistence';
import type { AgentRecord } from './agent-registry';

function makeNotifier(): AgentNotifier {
  return {
    notifyRenderer: vi.fn(),
    showApprovalNotification: vi.fn(),
  } as unknown as AgentNotifier;
}

function makePersistence(): AgentPersistence {
  return {
    updateStatus: vi.fn(),
  } as unknown as AgentPersistence;
}

function makeRecord(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    agentId: overrides.agentId ?? 'agent-1',
    sessionId: overrides.sessionId ?? 'session-1',
    session: {} as any,
    intentId: 'intent-1',
    selectedText: '',
    anchor: { quote: '', prefix: '', suffix: '' },
    status: 'running',
    pendingApprovalId: null,
    pendingPermissionKind: null,
    pendingApprovals: new Map(),
    summary: '',
    ...overrides,
  };
}

describe('InteractionBroker', () => {
  let broker: InteractionBroker;
  let notifier: ReturnType<typeof makeNotifier>;
  let persistence: ReturnType<typeof makePersistence>;

  beforeEach(() => {
    notifier = makeNotifier();
    persistence = makePersistence();
    broker = new InteractionBroker(notifier, persistence);
  });

  describe('approveAgent', () => {
    it('resolves pending approval callback with true', async () => {
      const record = makeRecord();
      const handler = broker.createPermissionHandler((sid) => sid === 'session-1' ? record : undefined);

      const promise = handler({ kind: 'file_edit', toolCallId: 'req-1' }, { sessionId: 'session-1' });

      // Approve the request
      broker.approveAgent('agent-1', 'req-1', true);

      const result = await promise;
      expect(result).toEqual({ kind: 'approve-once' });
    });

    it('logs permission request and resolution', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const record = makeRecord();
      const handler = broker.createPermissionHandler((sid) => sid === 'session-1' ? record : undefined);

      const promise = handler({ kind: 'read', toolCallId: 'req-2' }, { sessionId: 'session-1' });
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Permission requested: kind=read requestId=req-2')
      );

      broker.approveAgent('agent-1', 'req-2', true);
      await promise;
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Permission resolved: requestId=req-2 result=approve-once')
      );
      logSpy.mockRestore();
    });

    it('resolves pending approval callback with denial', async () => {
      const record = makeRecord();
      const handler = broker.createPermissionHandler((sid) => sid === 'session-1' ? record : undefined);

      const promise = handler({ kind: 'file_edit', toolCallId: 'req-1' }, { sessionId: 'session-1' });

      broker.approveAgent('agent-1', 'req-1', false);

      const result = await promise;
      expect(result).toEqual({ kind: 'reject' });
    });

    it('logs warning for unknown requestId', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      broker.approveAgent('agent-1', 'unknown-req', true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No approval callback for requestId=unknown-req')
      );
      warnSpy.mockRestore();
    });

    it('notifies renderer on approval resolution', () => {
      broker.approveAgent('agent-1', 'req-1', true);

      expect(notifier.notifyRenderer).toHaveBeenCalledWith('chat:event:agent-1', {
        type: 'approval.resolved',
        requestId: 'req-1',
        approved: true,
      });
    });
  });

  describe('respondToUserInput', () => {
    it('resolves pending user input callback', async () => {
      const record = makeRecord();
      const handler = broker.createUserInputHandler((sid) => sid === 'session-1' ? record : undefined);

      const promise = handler(
        { question: 'Pick a color', choices: ['red', 'blue'] },
        { sessionId: 'session-1' },
      );

      // We need to find the requestId. The handler uses crypto.randomUUID() so we
      // spy on notifier to capture the requestId from the notification.
      const call = vi.mocked(notifier.notifyRenderer).mock.calls.find(
        c => typeof c[1] === 'object' && (c[1] as any).type === 'user_input.requested'
      );
      expect(call).toBeDefined();
      const requestId = (call![1] as any).requestId;

      broker.respondToUserInput('agent-1', requestId, 'blue', false);

      const result = await promise;
      expect(result).toEqual({ answer: 'blue', wasFreeform: false });
    });

    it('is a no-op for unknown requestId', () => {
      broker.respondToUserInput('agent-1', 'unknown', 'test', true);
      // Should not throw
    });

    it('notifies renderer on resolution', () => {
      broker.respondToUserInput('agent-1', 'req-1', 'answer', true);

      expect(notifier.notifyRenderer).toHaveBeenCalledWith('chat:event:agent-1', {
        type: 'user_input.resolved',
        requestId: 'req-1',
        answer: 'answer',
        wasFreeform: true,
      });
    });
  });

  describe('respondToElicitation', () => {
    it('resolves pending elicitation callback with action and content', async () => {
      const record = makeRecord();
      const handler = broker.createElicitationHandler((sid) => sid === 'session-1' ? record : undefined);

      const promise = handler({
        sessionId: 'session-1',
        message: 'Enter details',
        requestedSchema: {},
        mode: 'inline',
        elicitationSource: 'tool',
      } as any);

      const call = vi.mocked(notifier.notifyRenderer).mock.calls.find(
        c => typeof c[1] === 'object' && (c[1] as any).type === 'elicitation.requested'
      );
      expect(call).toBeDefined();
      const requestId = (call![1] as any).requestId;

      broker.respondToElicitation('agent-1', requestId, 'accept', { name: 'test' });

      const result = await promise;
      expect(result.action).toBe('accept');
      expect(result.content).toEqual({ name: 'test' });
    });

    it('resolves with cancel when declined', async () => {
      const record = makeRecord();
      const handler = broker.createElicitationHandler((sid) => sid === 'session-1' ? record : undefined);

      const promise = handler({
        sessionId: 'session-1',
        message: 'Enter details',
        requestedSchema: {},
        mode: 'inline',
        elicitationSource: 'tool',
      } as any);

      const call = vi.mocked(notifier.notifyRenderer).mock.calls.find(
        c => typeof c[1] === 'object' && (c[1] as any).type === 'elicitation.requested'
      );
      const requestId = (call![1] as any).requestId;

      broker.respondToElicitation('agent-1', requestId, 'cancel');

      const result = await promise;
      expect(result.action).toBe('cancel');
    });

    it('notifies renderer on resolution', () => {
      broker.respondToElicitation('agent-1', 'req-1', 'decline');

      expect(notifier.notifyRenderer).toHaveBeenCalledWith('chat:event:agent-1', {
        type: 'elicitation.resolved',
        requestId: 'req-1',
        action: 'decline',
        content: undefined,
      });
    });
  });

  describe('clearPendingInteractions', () => {
    it('cancels all pending approval callbacks', async () => {
      const record = makeRecord();
      const handler = broker.createPermissionHandler((sid) => sid === 'session-1' ? record : undefined);

      const promise = handler({ kind: 'file_edit', toolCallId: 'req-1' }, { sessionId: 'session-1' });

      broker.clearPendingInteractions(record);

      const result = await promise;
      expect(result).toEqual({ kind: 'reject' });
    });

    it('cancels all pending user input callbacks', async () => {
      const record = makeRecord();
      const handler = broker.createUserInputHandler((sid) => sid === 'session-1' ? record : undefined);

      const promise = handler({ question: 'test?' }, { sessionId: 'session-1' });

      broker.clearPendingInteractions(record);

      const result = await promise;
      expect(result).toEqual({ answer: '', wasFreeform: true });
    });

    it('cancels all pending elicitation callbacks', async () => {
      const record = makeRecord();
      const handler = broker.createElicitationHandler((sid) => sid === 'session-1' ? record : undefined);

      const promise = handler({
        sessionId: 'session-1',
        message: 'test',
        requestedSchema: {},
        mode: 'inline',
        elicitationSource: 'tool',
      } as any);

      broker.clearPendingInteractions(record);

      const result = await promise;
      expect(result).toEqual({ action: 'cancel' });
    });

    it('clears record pending approval state', () => {
      const record = makeRecord();
      record.pendingApprovals.set('req-1', { permissionKind: 'file_edit' });
      record.pendingApprovalId = 'req-1';
      record.pendingPermissionKind = 'file_edit';

      broker.clearPendingInteractions(record);

      expect(record.pendingApprovals.size).toBe(0);
      expect(record.pendingApprovalId).toBeNull();
      expect(record.pendingPermissionKind).toBeNull();
    });
  });

  describe('createPermissionHandler', () => {
    it('returns denied when record is not found', async () => {
      const handler = broker.createPermissionHandler(() => undefined);
      const result = await handler({ kind: 'file_edit' }, { sessionId: 'unknown' });
      expect(result).toEqual({ kind: 'reject' });
    });

    it('updates record status to waiting-approval', async () => {
      const record = makeRecord();
      const handler = broker.createPermissionHandler((sid) => sid === 'session-1' ? record : undefined);

      // Don't await — the promise won't resolve until approved
      handler({ kind: 'file_edit', toolCallId: 'req-1' }, { sessionId: 'session-1' });

      expect(record.status).toBe('waiting-approval');
      expect(record.pendingApprovalId).toBe('req-1');
      expect(record.pendingPermissionKind).toBe('file_edit');

      // Clean up
      broker.approveAgent('agent-1', 'req-1', false);
    });

    it('sends approval notification', async () => {
      const record = makeRecord();
      const handler = broker.createPermissionHandler((sid) => sid === 'session-1' ? record : undefined);

      handler({ kind: 'file_edit', toolCallId: 'req-1' }, { sessionId: 'session-1' });

      expect(notifier.showApprovalNotification).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'agent-1',
        requestId: 'req-1',
        permissionKind: 'file_edit',
      }));
      expect(notifier.notifyRenderer).toHaveBeenCalledWith('agent:approval-needed', expect.objectContaining({
        agentId: 'agent-1',
        requestId: 'req-1',
        permissionKind: 'file_edit',
      }));

      broker.approveAgent('agent-1', 'req-1', false);
    });
  });

  describe('createUserInputHandler', () => {
    it('returns empty response when record is not found', async () => {
      const handler = broker.createUserInputHandler(() => undefined);
      const result = await handler({ question: 'test?' }, { sessionId: 'unknown' });
      expect(result).toEqual({ answer: '', wasFreeform: true });
    });
  });

  describe('createElicitationHandler', () => {
    it('returns cancel when record is not found', async () => {
      const handler = broker.createElicitationHandler(() => undefined);
      const result = await handler({
        sessionId: 'unknown',
        message: 'test',
        requestedSchema: {},
        mode: 'inline',
        elicitationSource: 'tool',
      } as any);
      expect(result).toEqual({ action: 'cancel' });
    });
  });

  describe('createSandboxedPermissionHandler', () => {
    it('auto-approves read requests', async () => {
      const record = makeRecord();
      const handler = broker.createSandboxedPermissionHandler(
        (sid) => sid === 'session-1' ? record : undefined,
      );

      const result = await handler(
        { kind: 'read', toolCallId: 'req-r1' },
        { sessionId: 'session-1' },
      );
      expect(result).toEqual({ kind: 'approve-once' });
    });

    it('auto-denies write requests', async () => {
      const record = makeRecord();
      const handler = broker.createSandboxedPermissionHandler(
        (sid) => sid === 'session-1' ? record : undefined,
      );

      const result = await handler(
        { kind: 'write', toolCallId: 'req-w1' },
        { sessionId: 'session-1' },
      );
      expect(result).toEqual({ kind: 'reject' });
    });

    it('falls through to normal handler for other kinds', async () => {
      const record = makeRecord();
      const handler = broker.createSandboxedPermissionHandler(
        (sid) => sid === 'session-1' ? record : undefined,
      );

      // shell/mcp/url etc. should trigger the normal interactive flow
      const promise = handler(
        { kind: 'shell', toolCallId: 'req-s1' },
        { sessionId: 'session-1' },
      );

      // Approve via the normal flow
      broker.approveAgent('agent-1', 'req-s1', true);
      const result = await promise;
      expect(result).toEqual({ kind: 'approve-once' });
    });
  });
});
