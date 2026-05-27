import type {
  IpcCommandArgs,
  IpcCommandResult,
  IpcEventPayload,
  AgentPersona,
  CliToolDefinition,
  CustomMcpServer,
  SandboxPolicy,
} from '../shared/ipc-contract';
import type { ChatEvent } from '../shared/chat-types';
import type { AgentAnchor, RecurrenceResult, RecallMatch, Skill, SkillContent, SkillScheduleFrequency, CanvasTarget, UpdateState } from '../shared/types';

const { contextBridge, ipcRenderer } = require('electron');

// ---------------------------------------------------------------------------
// Typed API interfaces — exported so the renderer can declare window.whimAPI
// ---------------------------------------------------------------------------

export interface SubagentAPI {
  list(parentAgentId: string): Promise<IpcCommandResult<'subagent:list'>>;
  listPersisted(parentAgentId: string): Promise<any[]>;
  read(parentAgentId: string, agentId: string): Promise<IpcCommandResult<'subagent:read'>>;
  write(parentAgentId: string, agentId: string, message: string): Promise<IpcCommandResult<'subagent:write'>>;
  cancel(parentAgentId: string, agentId: string): Promise<IpcCommandResult<'subagent:cancel'>>;
  onChanged(parentAgentId: string, callback: () => void): () => void;
}

export interface WhimAPI {
  // ── Spaces ──────────────────────────────────────────────
  create(input: IpcCommandArgs<'space:create'>[0]): Promise<IpcCommandResult<'space:create'>>;
  list(): Promise<IpcCommandResult<'space:list'>>;
  update(id: string, updates: IpcCommandArgs<'space:update'>[1]): Promise<IpcCommandResult<'space:update'>>;
  delete(id: string): Promise<IpcCommandResult<'space:delete'>>;
  dismissRecurrence(id: string): Promise<IpcCommandResult<'space:dismiss-recurrence'>>;
  listEvents(limit?: number): Promise<IpcCommandResult<'space:events'>>;
  resolveDate(dateText: string): Promise<IpcCommandResult<'space:resolve-date'>>;
  classifyInput(text: string): Promise<IpcCommandResult<'space:classify'>>;
  searchSpaces(query: string): Promise<IpcCommandResult<'space:search'>>;
  unarchive(id: string): Promise<IpcCommandResult<'space:unarchive'>>;
  summarizeTitle(canvasContent: string): Promise<IpcCommandResult<'space:summarize-title'>>;

  // ── Voice ────────────────────────────────────────────────
  transcribe(audioData: number[]): Promise<IpcCommandResult<'voice:transcribe'>>;

  // ── Settings ─────────────────────────────────────────────
  getSetting(key: string): Promise<IpcCommandResult<'settings:get'>>;
  setSetting(key: string, value: string): Promise<IpcCommandResult<'settings:set'>>;

  // ── CLI / Models ─────────────────────────────────────────
  resolveCliPath(): Promise<IpcCommandResult<'cli:resolve-path'>>;
  checkCliVersion(): Promise<IpcCommandResult<'cli:check-version'>>;
  checkCliMxcCapable(): Promise<IpcCommandResult<'cli:check-mxc-capable'>>;
  listModels(): Promise<IpcCommandResult<'models:list'>>;

  // ── Personas ─────────────────────────────────────────────
  listPersonas(): Promise<IpcCommandResult<'personas:list'>>;
  savePersonas(personas: AgentPersona[]): Promise<IpcCommandResult<'personas:save'>>;

  // ── CLI Runtimes ─────────────────────────────────────────
  listRuntimes(): Promise<{ id: string; label: string; path: string }[]>;
  saveRuntimes(runtimes: { id: string; label: string; path: string }[]): Promise<{ ok?: boolean; error?: string; runtimes?: { id: string; label: string; path: string }[] }>;

  // ── MCP servers ──────────────────────────────────────────
  listDiscoveredMcp(): Promise<IpcCommandResult<'mcp:list-discovered'>>;
  listCustomMcp(): Promise<IpcCommandResult<'mcp:list-custom'>>;
  saveCustomMcp(servers: CustomMcpServer[]): Promise<IpcCommandResult<'mcp:save-custom'>>;

  // ── CLI tools ────────────────────────────────────────────
  listCliTools(): Promise<IpcCommandResult<'cli-tools:list'>>;
  saveCliTools(tools: CliToolDefinition[]): Promise<IpcCommandResult<'cli-tools:save'>>;
  // ── Sandbox default policy ───────────────────────────────
  getSandboxDefaultPolicy(): Promise<IpcCommandResult<'sandbox:get-default'>>;
  saveSandboxDefaultPolicy(policy: SandboxPolicy): Promise<IpcCommandResult<'sandbox:save-default'>>;
  openSandboxConfigPreview(policy: SandboxPolicy): Promise<IpcCommandResult<'sandbox:open-config-preview'>>;

  // ── Sessions ─────────────────────────────────────────────
  launchSession(spaceId: string): Promise<IpcCommandResult<'session:launch'>>;
  getActiveSessions(): Promise<IpcCommandResult<'session:active-spaces'>>;

  // ── Workspace / Shell ────────────────────────────────────
  selectWorkspace(): Promise<IpcCommandResult<'workspace:select'>>;
  clearWorkspace(): Promise<IpcCommandResult<'workspace:clear'>>;
  openPath(folderPath: string): Promise<IpcCommandResult<'shell:openPath'>>;
  openExternal(url: string): Promise<IpcCommandResult<'shell:openExternal'>>;

  // ── Git sync ────────────────────────────────────────────
  gitSyncStatus(): Promise<IpcCommandResult<'workspace:git-status'>>;
  gitPush(): Promise<IpcCommandResult<'workspace:git-push'>>;
  gitPull(): Promise<IpcCommandResult<'workspace:git-pull'>>;
  onGitSyncChanged(callback: (status: IpcEventPayload<'workspace:git-sync-changed'>) => void): void;

  // ── Canvas ───────────────────────────────────────────────
  readCanvas(spaceId: string): Promise<IpcCommandResult<'canvas:read'>>;
  writeCanvas(spaceId: string, content: string): Promise<IpcCommandResult<'canvas:write'>>;
  closeCanvas(spaceId: string, content: string): Promise<IpcCommandResult<'canvas:close'>>;
  canvasHistory(spaceId: string): Promise<IpcCommandResult<'canvas:history'>>;
  canvasRestore(spaceId: string, sha: string): Promise<IpcCommandResult<'canvas:restore'>>;
  canvasPreviewVersion(spaceId: string, sha: string): Promise<IpcCommandResult<'canvas:preview-version'>>;
  readActivityLog(spaceId: string): Promise<{ events: any[]; error?: string }>;
  pasteFile(spaceId: string, filename: string, dataArray: number[]): Promise<IpcCommandResult<'canvas:paste-file'>>;
  readFile(spaceId: string, relativePath: string): Promise<{ data?: number[]; mimeType?: string; error?: string }>;
  openSpaceFolder(spaceId: string): Promise<void>;

  // ── Agent ────────────────────────────────────────────────
  launchAgent(spaceId: string, selectedText: string, anchor: AgentAnchor, options?: { repo?: string; model?: string }): Promise<IpcCommandResult<'agent:launch'>>;
  launchDocumentAgent(spaceId: string): Promise<{ agentId: string; sessionId: string } | { error: string }>;
  launchCommentAgent(spaceId: string, commentBody: string, quotedText: string, anchor: AgentAnchor, personaHandle: string, threadId: string | null): Promise<IpcCommandResult<'agent:launch-from-comment'>>;
  listAgents(spaceId: string): Promise<IpcCommandResult<'agent:list'>>;
  approveAgent(agentId: string, requestId: string, approved: boolean): Promise<IpcCommandResult<'agent:approve'>>;
  respondToUserInput(agentId: string, requestId: string, answer: string, wasFreeform: boolean): Promise<IpcCommandResult<'agent:respond-user-input'>>;
  respondToElicitation(agentId: string, requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>): Promise<IpcCommandResult<'agent:respond-elicitation'>>;
  resolveSandboxBlock(agentId: string, requestId: string, decision: 'allow-once' | 'allow-for-session' | 'disable'): Promise<IpcCommandResult<'agent:resolve-sandbox'>>;
  disableSandbox(agentId: string): Promise<{ ok?: boolean; error?: string }>;
  abortAgent(agentId: string): Promise<IpcCommandResult<'agent:abort'>>;
  openAgentCli(agentId: string): Promise<IpcCommandResult<'agent:open-cli'>>;
  quickLaunchAgent(prompt: string, personaHandle?: string): Promise<IpcCommandResult<'agent:quick-launch'>>;
  listAllAgents(): Promise<IpcCommandResult<'agent:list-all'>>;
  deleteAgentSession(agentId: string): Promise<IpcCommandResult<'agent:delete-session'>>;
  launchCloudAgent(spaceId: string, prompt: string): Promise<IpcCommandResult<'agent:launch-cloud'>>;
  getCloudJobStatus(agentId: string): Promise<IpcCommandResult<'agent:cloud-status'>>;
  getAgentHistory(agentId: string): Promise<IpcCommandResult<'agent:get-history'>>;
  getAgentWorkingDir(agentId: string): Promise<string | null>;
  setAgentYolo(agentId: string, enabled: boolean): Promise<IpcCommandResult<'agent:set-yolo'>>;
  enableRemote(agentId: string): Promise<IpcCommandResult<'agent:enable-remote'>>;
  disableRemote(agentId: string): Promise<IpcCommandResult<'agent:disable-remote'>>;

  // ── App-level remote ────────────────────────────────────
  setAppRemote(enabled: boolean): Promise<IpcCommandResult<'app:set-remote'>>;
  getAppRemoteStatus(): Promise<IpcCommandResult<'app:get-remote-status'>>;
  onAppRemoteChanged(callback: (data: { enabled: boolean; agents: Array<{ agentId: string; url?: string }> }) => void): void;

  // ── CLI session ──────────────────────────────────────────
  launchCliSession(): Promise<IpcCommandResult<'cli:launch-session'>>;

  // ── Chat ─────────────────────────────────────────────────
  sendChatMessage(agentId: string, prompt: string, attachments?: Array<{ type: 'file'; path: string }>): Promise<IpcCommandResult<'chat:send-message'>>;
  setChatModel(agentId: string, model: string): Promise<IpcCommandResult<'chat:set-model'>>;
  onChatEvent(agentId: string, callback: (event: ChatEvent) => void): () => void;

  // ── Sub-agents ───────────────────────────────────────────
  subagentAPI: SubagentAPI;

  // ── Window (fire-and-forget) ─────────────────────────────
  hideWindow(): void;
  expandWindow(): void;
  collapseWindow(): void;
  getPinned(): Promise<IpcCommandResult<'window:get-pinned'>>;
  setPinned(pinned: boolean): void;
  onPinnedChanged(callback: (pinned: boolean) => void): void;

  // ── Canvas popout window ─────────────────────────────────
  openCanvasWindow(target: CanvasTarget): void;
  openNewCanvasWindow(target: CanvasTarget): void;
  onLoadCanvasTarget(callback: (target: CanvasTarget) => void): void;
  onCanvasWindowClosed(callback: () => void): void;
  setCanvasAlwaysOnTop(pinned: boolean): void;
  getCanvasAlwaysOnTop(): Promise<boolean>;
  notifyCanvasThemeChanged(theme: string): void;
  onCanvasThemeChanged(callback: (theme: string) => void): void;
  openAgentChatInPanel(data: { agentId: string; agentPrompt: string; agentStatus: string; agentSource?: 'sdk' | 'cli'; spaceId?: string }): void;
  onOpenAgentChatInPanel(callback: (data: { agentId: string; agentPrompt: string; agentStatus: string; agentSource?: 'sdk' | 'cli'; spaceId?: string }) => void): void;

  // ── Canvas child pages ──────────────────────────────────
  createPage(spaceId: string, pageName: string): Promise<{ success: boolean; page: string; error?: string }>;
  readPage(spaceId: string, pageName: string): Promise<{ content: string; error?: string }>;
  writePage(spaceId: string, pageName: string, content: string): Promise<{ success?: boolean; error?: string }>;
  closePage(spaceId: string, pageName: string, content: string): Promise<{ success?: boolean; error?: string }>;
  listPages(spaceId: string): Promise<{ pages: string[]; error?: string }>;
  openPageWindow(target: { kind: 'page'; spaceId: string; page: string; title: string }): void;
  openLink(spaceId: string, url: string): Promise<{ action: string; error?: string }>;

  // ── Settings popout window ──────────────────────────────
  openSettingsWindow(): void;

  // ── Window / workspace events ────────────────────────────
  onWindowShown(callback: (data: { side: 'left' | 'right'; expanded: boolean }) => void): void;
  onWindowToggle(callback: () => void): void;
  onRequestHide(callback: () => void): void;
  onWorkspaceCommitted(callback: () => void): void;
  onWorkspaceChanged(callback: (path: string | null) => void): void;

  // ── Agent events ─────────────────────────────────────────
  onAgentStatusChanged(callback: (data: IpcEventPayload<'agent:status-changed'>) => void): void;
  onAgentApprovalNeeded(callback: (data: IpcEventPayload<'agent:approval-needed'>) => void): void;
  onAgentSandboxBlocked(callback: (data: IpcEventPayload<'agent:sandbox-blocked'>) => void): void;
  onAgentCompleted(callback: (data: IpcEventPayload<'agent:completed'>) => void): void;
  onAgentYoloChanged(callback: (data: IpcEventPayload<'agent:yolo-changed'>) => void): void;
  onAgentRemoteChanged(callback: (data: IpcEventPayload<'agent:remote-changed'>) => void): void;
  onNotificationApprovalClicked(callback: (data: IpcEventPayload<'notification:approval-clicked'>) => void): void;
  onAgentPresenceStarted(callback: (data: IpcEventPayload<'agent:presence-started'>) => void): void;
  onAgentPresenceEnded(callback: (data: IpcEventPayload<'agent:presence-ended'>) => void): void;
  onAgentReplyReady(callback: (data: IpcEventPayload<'agent:reply-ready'>) => void): void;
  onCanvasContentUpdated(callback: (data: IpcEventPayload<'canvas:content-updated'>) => void): () => void;

  // ── Space events ────────────────────────────────────────
  onSpaceProcessed(callback: (id: string) => void): void;
  onRecurrenceResult(callback: (spaceId: string, result: RecurrenceResult) => void): void;
  onRecurrenceApplied(callback: (spaceId: string) => void): void;
  onRecallHint(callback: (spaceId: string, match: RecallMatch) => void): void;

  // ── Skills ──────────────────────────────────────────────
  listSkills(): Promise<IpcCommandResult<'skill:list'>>;
  readSkill(skillId: string): Promise<IpcCommandResult<'skill:read'>>;
  writeSkill(skillId: string, frontmatter: Record<string, unknown>, body: string): Promise<IpcCommandResult<'skill:write'>>;
  createSkill(name: string): Promise<IpcCommandResult<'skill:create'>>;
  createSkillFromPrompt(description: string): Promise<IpcCommandResult<'skill:create-from-prompt'>>;
  deleteSkill(skillId: string): Promise<IpcCommandResult<'skill:delete'>>;
  openSkillFolder(skillId: string): Promise<IpcCommandResult<'skill:open-folder'>>;
  createSpaceFromSkill(skillId: string): Promise<IpcCommandResult<'skill:create-space'>>;
  launchSkill(skillId: string): Promise<IpcCommandResult<'skill:launch'>>;
  setSkillSchedule(skillId: string, frequency: SkillScheduleFrequency, time: string, day: number | null): Promise<IpcCommandResult<'skill:set-schedule'>>;
  clearSkillSchedule(skillId: string): Promise<IpcCommandResult<'skill:clear-schedule'>>;
  onSkillsChanged(callback: () => void): void;

  // ── Updates ──────────────────────────────────────────────
  onUpdateStateChanged(callback: (state: UpdateState) => void): () => void;
  installUpdate(): Promise<void>;
  checkForUpdate(): Promise<void>;
  downloadUpdate(): Promise<void>;

  // ── Platform ─────────────────────────────────────────────
  getPlatform(): string;
}

// ---------------------------------------------------------------------------
// Implementation — runtime behavior is identical to the original
// ---------------------------------------------------------------------------

const api: WhimAPI = {
  // ── Spaces ──────────────────────────────────────────────
  create: (input) =>
    ipcRenderer.invoke('space:create', input),
  list: () => ipcRenderer.invoke('space:list'),
  update: (id, updates) =>
    ipcRenderer.invoke('space:update', id, updates),
  delete: (id) => ipcRenderer.invoke('space:delete', id),
  dismissRecurrence: (id) => ipcRenderer.invoke('space:dismiss-recurrence', id),
  listEvents: (limit?) => ipcRenderer.invoke('space:events', limit),
  resolveDate: (dateText) => ipcRenderer.invoke('space:resolve-date', dateText),
  classifyInput: (text) => ipcRenderer.invoke('space:classify', text),
  searchSpaces: (query) => ipcRenderer.invoke('space:search', query),
  unarchive: (id) => ipcRenderer.invoke('space:unarchive', id),
  summarizeTitle: (canvasContent) => ipcRenderer.invoke('space:summarize-title', canvasContent),

  // ── Voice ────────────────────────────────────────────────
  transcribe: (audioData) => ipcRenderer.invoke('voice:transcribe', audioData),

  // ── Settings ─────────────────────────────────────────────
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // ── CLI / Models ─────────────────────────────────────────
  resolveCliPath: () => ipcRenderer.invoke('cli:resolve-path'),
  checkCliVersion: () => ipcRenderer.invoke('cli:check-version'),
  checkCliMxcCapable: () => ipcRenderer.invoke('cli:check-mxc-capable'),
  listModels: () => ipcRenderer.invoke('models:list'),

  // ── Personas ─────────────────────────────────────────────
  listPersonas: () => ipcRenderer.invoke('personas:list'),
  savePersonas: (personas) => ipcRenderer.invoke('personas:save', personas),

  // ── CLI Runtimes ─────────────────────────────────────────
  listRuntimes: () => ipcRenderer.invoke('runtimes:list'),
  saveRuntimes: (runtimes) => ipcRenderer.invoke('runtimes:save', runtimes),

  // ── MCP servers ──────────────────────────────────────────
  listDiscoveredMcp: () => ipcRenderer.invoke('mcp:list-discovered'),
  listCustomMcp: () => ipcRenderer.invoke('mcp:list-custom'),
  saveCustomMcp: (servers) => ipcRenderer.invoke('mcp:save-custom', servers),

  // ── CLI tools ────────────────────────────────────────────
  listCliTools: () => ipcRenderer.invoke('cli-tools:list'),
  saveCliTools: (tools) => ipcRenderer.invoke('cli-tools:save', tools),
  getSandboxDefaultPolicy: () => ipcRenderer.invoke('sandbox:get-default'),
  saveSandboxDefaultPolicy: (policy) => ipcRenderer.invoke('sandbox:save-default', policy),
  openSandboxConfigPreview: (policy) => ipcRenderer.invoke('sandbox:open-config-preview', policy),

  // ── Sessions ─────────────────────────────────────────────
  launchSession: (spaceId) => ipcRenderer.invoke('session:launch', spaceId),
  getActiveSessions: () => ipcRenderer.invoke('session:active-spaces'),

  // ── Workspace / Shell ────────────────────────────────────
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  clearWorkspace: () => ipcRenderer.invoke('workspace:clear'),
  openPath: (folderPath) => ipcRenderer.invoke('shell:openPath', folderPath),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // ── Git sync ────────────────────────────────────────────
  gitSyncStatus: () => ipcRenderer.invoke('workspace:git-status'),
  gitPush: () => ipcRenderer.invoke('workspace:git-push'),
  gitPull: () => ipcRenderer.invoke('workspace:git-pull'),
  onGitSyncChanged: (callback) => {
    ipcRenderer.on('workspace:git-sync-changed', (_event: unknown, status: any) => callback(status));
  },

  // ── Canvas ───────────────────────────────────────────────
  readCanvas: (spaceId) => ipcRenderer.invoke('canvas:read', spaceId),
  writeCanvas: (spaceId, content) => ipcRenderer.invoke('canvas:write', spaceId, content),
  closeCanvas: (spaceId, content) => ipcRenderer.invoke('canvas:close', spaceId, content),
  canvasHistory: (spaceId) => ipcRenderer.invoke('canvas:history', spaceId),
  canvasRestore: (spaceId, sha) => ipcRenderer.invoke('canvas:restore', spaceId, sha),
  canvasPreviewVersion: (spaceId, sha) => ipcRenderer.invoke('canvas:preview-version', spaceId, sha),
  readActivityLog: (spaceId) => ipcRenderer.invoke('canvas:read-activity-log', spaceId),
  pasteFile: (spaceId, filename, dataArray) =>
    ipcRenderer.invoke('canvas:paste-file', spaceId, filename, dataArray),
  readFile: (spaceId, relativePath) =>
    ipcRenderer.invoke('canvas:read-file', spaceId, relativePath),
  openSpaceFolder: (spaceId) =>
    ipcRenderer.invoke('canvas:open-folder', spaceId),

  // ── Agent ────────────────────────────────────────────────
  launchAgent: (spaceId, selectedText, anchor, options?) =>
    ipcRenderer.invoke('agent:launch', spaceId, selectedText, anchor, options),
  launchDocumentAgent: (spaceId) =>
    ipcRenderer.invoke('agent:launch-document', spaceId),
  launchCommentAgent: (spaceId, commentBody, quotedText, anchor, personaHandle, threadId) =>
    ipcRenderer.invoke('agent:launch-from-comment', spaceId, commentBody, quotedText, anchor, personaHandle, threadId),
  listAgents: (spaceId) =>
    ipcRenderer.invoke('agent:list', spaceId),
  approveAgent: (agentId, requestId, approved) =>
    ipcRenderer.invoke('agent:approve', agentId, requestId, approved),
  respondToUserInput: (agentId, requestId, answer, wasFreeform) =>
    ipcRenderer.invoke('agent:respond-user-input', agentId, requestId, answer, wasFreeform),
  respondToElicitation: (agentId, requestId, action, content?) =>
    ipcRenderer.invoke('agent:respond-elicitation', agentId, requestId, action, content),
  resolveSandboxBlock: (agentId, requestId, decision) =>
    ipcRenderer.invoke('agent:resolve-sandbox', agentId, requestId, decision),
  disableSandbox: (agentId) =>
    ipcRenderer.invoke('agent:disable-sandbox', agentId),
  abortAgent: (agentId) =>
    ipcRenderer.invoke('agent:abort', agentId),
  openAgentCli: (agentId) =>
    ipcRenderer.invoke('agent:open-cli', agentId),
  quickLaunchAgent: (prompt, personaHandle) =>
    ipcRenderer.invoke('agent:quick-launch', prompt, personaHandle),
  listAllAgents: () =>
    ipcRenderer.invoke('agent:list-all'),
  deleteAgentSession: (agentId) =>
    ipcRenderer.invoke('agent:delete-session', agentId),
  launchCloudAgent: (spaceId, prompt) =>
    ipcRenderer.invoke('agent:launch-cloud', spaceId, prompt),
  getCloudJobStatus: (agentId) =>
    ipcRenderer.invoke('agent:cloud-status', agentId),
  getAgentHistory: (agentId) =>
    ipcRenderer.invoke('agent:get-history', agentId),
  getAgentWorkingDir: (agentId) =>
    ipcRenderer.invoke('agent:get-working-dir', agentId),
  setAgentYolo: (agentId, enabled) =>
    ipcRenderer.invoke('agent:set-yolo', agentId, enabled),
  enableRemote: (agentId) =>
    ipcRenderer.invoke('agent:enable-remote', agentId),
  disableRemote: (agentId) =>
    ipcRenderer.invoke('agent:disable-remote', agentId),

  // ── App-level remote ────────────────────────────────────
  setAppRemote: (enabled) =>
    ipcRenderer.invoke('app:set-remote', enabled),
  getAppRemoteStatus: () =>
    ipcRenderer.invoke('app:get-remote-status'),
  onAppRemoteChanged: (callback) => {
    ipcRenderer.on('app:remote-changed', (_event: unknown, data: any) => callback(data));
  },

  // ── CLI session ──────────────────────────────────────────
  launchCliSession: () =>
    ipcRenderer.invoke('cli:launch-session'),

  // ── Chat ─────────────────────────────────────────────────
  sendChatMessage: (agentId, prompt, attachments?) =>
    ipcRenderer.invoke('chat:send-message', agentId, prompt, attachments),
  setChatModel: (agentId, model) =>
    ipcRenderer.invoke('chat:set-model', agentId, model),
  onChatEvent: (agentId, callback) => {
    const channel = `chat:event:${agentId}`;
    const handler = (_event: unknown, data: ChatEvent) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => { ipcRenderer.removeListener(channel, handler); };
  },

  // ── Sub-agents ───────────────────────────────────────────
  subagentAPI: {
    list: (parentAgentId) =>
      ipcRenderer.invoke('subagent:list', parentAgentId),
    listPersisted: (parentAgentId) =>
      ipcRenderer.invoke('subagent:list-persisted', parentAgentId),
    read: (parentAgentId, agentId) =>
      ipcRenderer.invoke('subagent:read', parentAgentId, agentId),
    write: (parentAgentId, agentId, message) =>
      ipcRenderer.invoke('subagent:write', parentAgentId, agentId, message),
    cancel: (parentAgentId, agentId) =>
      ipcRenderer.invoke('subagent:cancel', parentAgentId, agentId),
    onChanged: (parentAgentId, callback) => {
      const channel = `subagent:changed:${parentAgentId}`;
      const handler = () => callback();
      ipcRenderer.on(channel, handler);
      return () => { ipcRenderer.removeListener(channel, handler); };
    },
  },

  // ── Window (fire-and-forget) ─────────────────────────────
  hideWindow: () => ipcRenderer.send('window:hide'),
  expandWindow: () => ipcRenderer.send('window:expand'),
  collapseWindow: () => ipcRenderer.send('window:collapse'),
  getPinned: () => ipcRenderer.invoke('window:get-pinned'),
  setPinned: (pinned) => ipcRenderer.send('window:set-pinned', pinned),
  onPinnedChanged: (callback) => {
    ipcRenderer.on('window:pinned-changed', (_event: unknown, pinned: boolean) => callback(pinned));
  },

  // ── Canvas popout window ─────────────────────────────────
  openCanvasWindow: (target) => ipcRenderer.send('canvas-window:open', target),
  openNewCanvasWindow: (target) => ipcRenderer.send('canvas-window:open-new', target),
  onLoadCanvasTarget: (callback) => {
    ipcRenderer.on('canvas-window:load-target', (_event: unknown, target: CanvasTarget) => callback(target));
  },
  onCanvasWindowClosed: (callback) => {
    ipcRenderer.on('canvas-window:closed', callback);
  },
  setCanvasAlwaysOnTop: (pinned) => ipcRenderer.send('canvas-window:set-always-on-top', pinned),
  getCanvasAlwaysOnTop: () => ipcRenderer.invoke('canvas-window:get-always-on-top'),
  notifyCanvasThemeChanged: (theme) => ipcRenderer.send('canvas-window:theme-changed', theme),
  onCanvasThemeChanged: (callback) => {
    ipcRenderer.on('canvas-window:theme-changed', (_event: unknown, theme: string) => callback(theme));
  },
  openAgentChatInPanel: (data) => ipcRenderer.send('main-window:open-agent-chat', data),
  onOpenAgentChatInPanel: (callback) => {
    ipcRenderer.on('main-window:open-agent-chat', (_event: unknown, data: { agentId: string; agentPrompt: string; agentStatus: string; agentSource?: 'sdk' | 'cli'; spaceId?: string }) => callback(data));
  },

  // ── Canvas child pages ──────────────────────────────────
  createPage: (spaceId, pageName) => ipcRenderer.invoke('canvas:create-page', spaceId, pageName),
  readPage: (spaceId, pageName) => ipcRenderer.invoke('canvas:read-page', spaceId, pageName),
  writePage: (spaceId, pageName, content) => ipcRenderer.invoke('canvas:write-page', spaceId, pageName, content),
  closePage: (spaceId, pageName, content) => ipcRenderer.invoke('canvas:close-page', spaceId, pageName, content),
  listPages: (spaceId) => ipcRenderer.invoke('canvas:list-pages', spaceId),
  openPageWindow: (target) => ipcRenderer.send('canvas-window:open-page', target),
  openLink: (spaceId, url) => ipcRenderer.invoke('canvas:open-link', spaceId, url),

  // ── Settings popout window ──────────────────────────────
  openSettingsWindow: () => ipcRenderer.send('settings-window:open'),

  // ── Window / workspace events ────────────────────────────
  onWindowShown: (callback) => {
    ipcRenderer.on('window:shown', (_event: unknown, data: { side: 'left' | 'right'; expanded: boolean }) => callback(data));
  },
  onWindowToggle: (callback) => {
    ipcRenderer.on('window:toggle', callback);
  },
  onRequestHide: (callback) => {
    ipcRenderer.on('window:request-hide', callback);
  },
  onWorkspaceCommitted: (callback) => {
    ipcRenderer.on('workspace:committed', callback);
  },
  onWorkspaceChanged: (callback) => {
    ipcRenderer.on('workspace:changed', (_event: unknown, path: string | null) => callback(path));
  },

  // ── Agent events ─────────────────────────────────────────
  onAgentStatusChanged: (callback) => {
    ipcRenderer.on('agent:status-changed', (_event: unknown, data: IpcEventPayload<'agent:status-changed'>) => callback(data));
  },
  onAgentApprovalNeeded: (callback) => {
    ipcRenderer.on('agent:approval-needed', (_event: unknown, data: IpcEventPayload<'agent:approval-needed'>) => callback(data));
  },
  onAgentSandboxBlocked: (callback) => {
    ipcRenderer.on('agent:sandbox-blocked', (_event: unknown, data: IpcEventPayload<'agent:sandbox-blocked'>) => callback(data));
  },
  onAgentCompleted: (callback) => {
    ipcRenderer.on('agent:completed', (_event: unknown, data: IpcEventPayload<'agent:completed'>) => callback(data));
  },
  onAgentYoloChanged: (callback) => {
    ipcRenderer.on('agent:yolo-changed', (_event: unknown, data: IpcEventPayload<'agent:yolo-changed'>) => callback(data));
  },
  onAgentRemoteChanged: (callback) => {
    ipcRenderer.on('agent:remote-changed', (_event: unknown, data: IpcEventPayload<'agent:remote-changed'>) => callback(data));
  },
  onNotificationApprovalClicked: (callback) => {
    ipcRenderer.on('notification:approval-clicked', (_event: unknown, data: IpcEventPayload<'notification:approval-clicked'>) => callback(data));
  },
  onAgentPresenceStarted: (callback) => {
    ipcRenderer.on('agent:presence-started', (_event: unknown, data: IpcEventPayload<'agent:presence-started'>) => callback(data));
  },
  onAgentPresenceEnded: (callback) => {
    ipcRenderer.on('agent:presence-ended', (_event: unknown, data: IpcEventPayload<'agent:presence-ended'>) => callback(data));
  },
  onAgentReplyReady: (callback) => {
    ipcRenderer.on('agent:reply-ready', (_event: unknown, data: IpcEventPayload<'agent:reply-ready'>) => callback(data));
  },
  onCanvasContentUpdated: (callback) => {
    const channel = 'canvas:content-updated';
    const handler = (_event: unknown, data: IpcEventPayload<'canvas:content-updated'>) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => { ipcRenderer.removeListener(channel, handler); };
  },

  // ── Space events ────────────────────────────────────────
  onSpaceProcessed: (callback) => {
    ipcRenderer.on('space:processed', (_event: unknown, id: string) => callback(id));
  },
  onRecurrenceResult: (callback) => {
    ipcRenderer.on('space:recurrence', (_event: unknown, spaceId: string, result: RecurrenceResult) => callback(spaceId, result));
  },
  onRecurrenceApplied: (callback) => {
    ipcRenderer.on('space:recurrence-applied', (_event: unknown, spaceId: string) => callback(spaceId));
  },
  onRecallHint: (callback) => {
    ipcRenderer.on('space:recall', (_event: unknown, spaceId: string, match: RecallMatch) => callback(spaceId, match));
  },

  // ── Skills ──────────────────────────────────────────────
  listSkills: () => ipcRenderer.invoke('skill:list'),
  readSkill: (skillId) => ipcRenderer.invoke('skill:read', skillId),
  writeSkill: (skillId, frontmatter, body) => ipcRenderer.invoke('skill:write', skillId, frontmatter, body),
  createSkill: (name) => ipcRenderer.invoke('skill:create', name),
  createSkillFromPrompt: (description) => ipcRenderer.invoke('skill:create-from-prompt', description),
  deleteSkill: (skillId) => ipcRenderer.invoke('skill:delete', skillId),
  openSkillFolder: (skillId) => ipcRenderer.invoke('skill:open-folder', skillId),
  createSpaceFromSkill: (skillId) => ipcRenderer.invoke('skill:create-space', skillId),
  launchSkill: (skillId) => ipcRenderer.invoke('skill:launch', skillId),
  setSkillSchedule: (skillId, frequency, time, day) => ipcRenderer.invoke('skill:set-schedule', skillId, frequency, time, day),
  clearSkillSchedule: (skillId) => ipcRenderer.invoke('skill:clear-schedule', skillId),
  onSkillsChanged: (callback) => {
    ipcRenderer.on('skills:changed', callback);
  },

  // ── Updates ──────────────────────────────────────────────
  onUpdateStateChanged: (callback) => {
    const handler = (_event: unknown, state: UpdateState) => callback(state);
    ipcRenderer.on('update:state-changed', handler);
    return () => { ipcRenderer.removeListener('update:state-changed', handler); };
  },
  installUpdate: () => ipcRenderer.invoke('update:install'),
  checkForUpdate: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),

  // ── Platform ─────────────────────────────────────────────
  getPlatform: () => process.platform,
};

contextBridge.exposeInMainWorld('whimAPI', api);

// Expose platform info so the renderer can apply platform-adaptive styling
contextBridge.exposeInMainWorld('__platform', process.platform);
