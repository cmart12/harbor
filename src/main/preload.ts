import type {
  IpcCommandArgs,
  IpcCommandResult,
  IpcEventPayload,
  AgentPersona,
  CliToolDefinition,
  CustomMcpServer,
} from '../shared/ipc-contract';
import type { ChatEvent } from '../shared/chat-types';
import type { AgentAnchor, RecurrenceResult, RecallMatch, Skill, SkillContent, CanvasTarget } from '../shared/types';

const { contextBridge, ipcRenderer } = require('electron');

// ---------------------------------------------------------------------------
// Typed API interfaces — exported so the renderer can declare window.intentAPI
// ---------------------------------------------------------------------------

export interface SubagentAPI {
  list(parentAgentId: string): Promise<IpcCommandResult<'subagent:list'>>;
  listPersisted(parentAgentId: string): Promise<any[]>;
  read(parentAgentId: string, agentId: string): Promise<IpcCommandResult<'subagent:read'>>;
  write(parentAgentId: string, agentId: string, message: string): Promise<IpcCommandResult<'subagent:write'>>;
  cancel(parentAgentId: string, agentId: string): Promise<IpcCommandResult<'subagent:cancel'>>;
  onChanged(parentAgentId: string, callback: () => void): () => void;
}

export interface IntentAPI {
  // ── Intents ──────────────────────────────────────────────
  create(input: IpcCommandArgs<'intent:create'>[0]): Promise<IpcCommandResult<'intent:create'>>;
  list(): Promise<IpcCommandResult<'intent:list'>>;
  update(id: string, updates: IpcCommandArgs<'intent:update'>[1]): Promise<IpcCommandResult<'intent:update'>>;
  delete(id: string): Promise<IpcCommandResult<'intent:delete'>>;
  dismissRecurrence(id: string): Promise<IpcCommandResult<'intent:dismiss-recurrence'>>;
  listEvents(limit?: number): Promise<IpcCommandResult<'intent:events'>>;
  resolveDate(dateText: string): Promise<IpcCommandResult<'intent:resolve-date'>>;
  classifyInput(text: string): Promise<IpcCommandResult<'intent:classify'>>;
  searchIntents(query: string): Promise<IpcCommandResult<'intent:search'>>;
  unarchive(id: string): Promise<IpcCommandResult<'intent:unarchive'>>;
  summarizeTitle(canvasContent: string): Promise<IpcCommandResult<'intent:summarize-title'>>;

  // ── Voice ────────────────────────────────────────────────
  transcribe(audioData: number[]): Promise<IpcCommandResult<'voice:transcribe'>>;

  // ── Settings ─────────────────────────────────────────────
  getSetting(key: string): Promise<IpcCommandResult<'settings:get'>>;
  setSetting(key: string, value: string): Promise<IpcCommandResult<'settings:set'>>;

  // ── CLI / Models ─────────────────────────────────────────
  resolveCliPath(): Promise<IpcCommandResult<'cli:resolve-path'>>;
  checkCliVersion(): Promise<IpcCommandResult<'cli:check-version'>>;
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

  // ── Sessions ─────────────────────────────────────────────
  launchSession(intentId: string): Promise<IpcCommandResult<'session:launch'>>;
  getActiveSessions(): Promise<IpcCommandResult<'session:active-intents'>>;

  // ── Workspace / Shell ────────────────────────────────────
  selectWorkspace(): Promise<IpcCommandResult<'workspace:select'>>;
  clearWorkspace(): Promise<IpcCommandResult<'workspace:clear'>>;
  openPath(folderPath: string): Promise<IpcCommandResult<'shell:openPath'>>;

  // ── Canvas ───────────────────────────────────────────────
  readCanvas(intentId: string): Promise<IpcCommandResult<'canvas:read'>>;
  writeCanvas(intentId: string, content: string): Promise<IpcCommandResult<'canvas:write'>>;
  closeCanvas(intentId: string, content: string): Promise<IpcCommandResult<'canvas:close'>>;
  canvasHistory(intentId: string): Promise<IpcCommandResult<'canvas:history'>>;
  canvasRestore(intentId: string, sha: string): Promise<IpcCommandResult<'canvas:restore'>>;
  canvasPreviewVersion(intentId: string, sha: string): Promise<IpcCommandResult<'canvas:preview-version'>>;
  readActivityLog(intentId: string): Promise<{ events: any[]; error?: string }>;
  pasteFile(intentId: string, filename: string, dataArray: number[]): Promise<IpcCommandResult<'canvas:paste-file'>>;
  readFile(intentId: string, relativePath: string): Promise<{ data?: number[]; mimeType?: string; error?: string }>;
  openIntentFolder(intentId: string): Promise<void>;

  // ── Agent ────────────────────────────────────────────────
  launchAgent(intentId: string, selectedText: string, anchor: AgentAnchor, options?: { repo?: string; model?: string }): Promise<IpcCommandResult<'agent:launch'>>;
  launchDocumentAgent(intentId: string): Promise<{ agentId: string; sessionId: string } | { error: string }>;
  launchCommentAgent(intentId: string, commentBody: string, quotedText: string, anchor: AgentAnchor, personaHandle: string, threadIndex: number): Promise<IpcCommandResult<'agent:launch-from-comment'>>;
  listAgents(intentId: string): Promise<IpcCommandResult<'agent:list'>>;
  approveAgent(agentId: string, requestId: string, approved: boolean): Promise<IpcCommandResult<'agent:approve'>>;
  respondToUserInput(agentId: string, requestId: string, answer: string, wasFreeform: boolean): Promise<IpcCommandResult<'agent:respond-user-input'>>;
  respondToElicitation(agentId: string, requestId: string, action: 'accept' | 'decline' | 'cancel', content?: Record<string, unknown>): Promise<IpcCommandResult<'agent:respond-elicitation'>>;
  abortAgent(agentId: string): Promise<IpcCommandResult<'agent:abort'>>;
  openAgentCli(agentId: string): Promise<IpcCommandResult<'agent:open-cli'>>;
  quickLaunchAgent(prompt: string): Promise<IpcCommandResult<'agent:quick-launch'>>;
  listAllAgents(): Promise<IpcCommandResult<'agent:list-all'>>;
  deleteAgentSession(agentId: string): Promise<IpcCommandResult<'agent:delete-session'>>;
  launchCloudAgent(intentId: string, prompt: string): Promise<IpcCommandResult<'agent:launch-cloud'>>;
  getCloudJobStatus(agentId: string): Promise<IpcCommandResult<'agent:cloud-status'>>;
  getAgentHistory(agentId: string): Promise<IpcCommandResult<'agent:get-history'>>;
  getAgentWorkingDir(agentId: string): Promise<string | null>;

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
  onLoadCanvasTarget(callback: (target: CanvasTarget) => void): void;
  onCanvasWindowClosed(callback: () => void): void;
  notifyCanvasThemeChanged(theme: string): void;
  onCanvasThemeChanged(callback: (theme: string) => void): void;

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
  onAgentCompleted(callback: (data: IpcEventPayload<'agent:completed'>) => void): void;
  onNotificationApprovalClicked(callback: (data: IpcEventPayload<'notification:approval-clicked'>) => void): void;
  onAgentPresenceStarted(callback: (data: IpcEventPayload<'agent:presence-started'>) => void): void;
  onAgentPresenceEnded(callback: (data: IpcEventPayload<'agent:presence-ended'>) => void): void;
  onAgentReplyReady(callback: (data: IpcEventPayload<'agent:reply-ready'>) => void): void;
  onCanvasContentUpdated(callback: (data: IpcEventPayload<'canvas:content-updated'>) => void): () => void;

  // ── Intent events ────────────────────────────────────────
  onIntentProcessed(callback: (id: string) => void): void;
  onRecurrenceResult(callback: (intentId: string, result: RecurrenceResult) => void): void;
  onRecurrenceApplied(callback: (intentId: string) => void): void;
  onRecallHint(callback: (intentId: string, match: RecallMatch) => void): void;

  // ── Skills ──────────────────────────────────────────────
  listSkills(): Promise<IpcCommandResult<'skill:list'>>;
  readSkill(skillId: string): Promise<IpcCommandResult<'skill:read'>>;
  writeSkill(skillId: string, frontmatter: Record<string, unknown>, body: string): Promise<IpcCommandResult<'skill:write'>>;
  createSkill(name: string): Promise<IpcCommandResult<'skill:create'>>;
  createSkillFromPrompt(description: string): Promise<IpcCommandResult<'skill:create-from-prompt'>>;
  deleteSkill(skillId: string): Promise<IpcCommandResult<'skill:delete'>>;
  openSkillFolder(skillId: string): Promise<IpcCommandResult<'skill:open-folder'>>;
  createIntentFromSkill(skillId: string): Promise<IpcCommandResult<'skill:create-intent'>>;
  launchSkill(skillId: string): Promise<IpcCommandResult<'skill:launch'>>;
  onSkillsChanged(callback: () => void): void;

  // ── Platform ─────────────────────────────────────────────
  getPlatform(): string;
}

// ---------------------------------------------------------------------------
// Implementation — runtime behavior is identical to the original
// ---------------------------------------------------------------------------

const api: IntentAPI = {
  // ── Intents ──────────────────────────────────────────────
  create: (input) =>
    ipcRenderer.invoke('intent:create', input),
  list: () => ipcRenderer.invoke('intent:list'),
  update: (id, updates) =>
    ipcRenderer.invoke('intent:update', id, updates),
  delete: (id) => ipcRenderer.invoke('intent:delete', id),
  dismissRecurrence: (id) => ipcRenderer.invoke('intent:dismiss-recurrence', id),
  listEvents: (limit?) => ipcRenderer.invoke('intent:events', limit),
  resolveDate: (dateText) => ipcRenderer.invoke('intent:resolve-date', dateText),
  classifyInput: (text) => ipcRenderer.invoke('intent:classify', text),
  searchIntents: (query) => ipcRenderer.invoke('intent:search', query),
  unarchive: (id) => ipcRenderer.invoke('intent:unarchive', id),
  summarizeTitle: (canvasContent) => ipcRenderer.invoke('intent:summarize-title', canvasContent),

  // ── Voice ────────────────────────────────────────────────
  transcribe: (audioData) => ipcRenderer.invoke('voice:transcribe', audioData),

  // ── Settings ─────────────────────────────────────────────
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),

  // ── CLI / Models ─────────────────────────────────────────
  resolveCliPath: () => ipcRenderer.invoke('cli:resolve-path'),
  checkCliVersion: () => ipcRenderer.invoke('cli:check-version'),
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

  // ── Sessions ─────────────────────────────────────────────
  launchSession: (intentId) => ipcRenderer.invoke('session:launch', intentId),
  getActiveSessions: () => ipcRenderer.invoke('session:active-intents'),

  // ── Workspace / Shell ────────────────────────────────────
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  clearWorkspace: () => ipcRenderer.invoke('workspace:clear'),
  openPath: (folderPath) => ipcRenderer.invoke('shell:openPath', folderPath),

  // ── Canvas ───────────────────────────────────────────────
  readCanvas: (intentId) => ipcRenderer.invoke('canvas:read', intentId),
  writeCanvas: (intentId, content) => ipcRenderer.invoke('canvas:write', intentId, content),
  closeCanvas: (intentId, content) => ipcRenderer.invoke('canvas:close', intentId, content),
  canvasHistory: (intentId) => ipcRenderer.invoke('canvas:history', intentId),
  canvasRestore: (intentId, sha) => ipcRenderer.invoke('canvas:restore', intentId, sha),
  canvasPreviewVersion: (intentId, sha) => ipcRenderer.invoke('canvas:preview-version', intentId, sha),
  readActivityLog: (intentId) => ipcRenderer.invoke('canvas:read-activity-log', intentId),
  pasteFile: (intentId, filename, dataArray) =>
    ipcRenderer.invoke('canvas:paste-file', intentId, filename, dataArray),
  readFile: (intentId, relativePath) =>
    ipcRenderer.invoke('canvas:read-file', intentId, relativePath),
  openIntentFolder: (intentId) =>
    ipcRenderer.invoke('canvas:open-folder', intentId),

  // ── Agent ────────────────────────────────────────────────
  launchAgent: (intentId, selectedText, anchor, options?) =>
    ipcRenderer.invoke('agent:launch', intentId, selectedText, anchor, options),
  launchDocumentAgent: (intentId) =>
    ipcRenderer.invoke('agent:launch-document', intentId),
  launchCommentAgent: (intentId, commentBody, quotedText, anchor, personaHandle, threadIndex) =>
    ipcRenderer.invoke('agent:launch-from-comment', intentId, commentBody, quotedText, anchor, personaHandle, threadIndex),
  listAgents: (intentId) =>
    ipcRenderer.invoke('agent:list', intentId),
  approveAgent: (agentId, requestId, approved) =>
    ipcRenderer.invoke('agent:approve', agentId, requestId, approved),
  respondToUserInput: (agentId, requestId, answer, wasFreeform) =>
    ipcRenderer.invoke('agent:respond-user-input', agentId, requestId, answer, wasFreeform),
  respondToElicitation: (agentId, requestId, action, content?) =>
    ipcRenderer.invoke('agent:respond-elicitation', agentId, requestId, action, content),
  abortAgent: (agentId) =>
    ipcRenderer.invoke('agent:abort', agentId),
  openAgentCli: (agentId) =>
    ipcRenderer.invoke('agent:open-cli', agentId),
  quickLaunchAgent: (prompt) =>
    ipcRenderer.invoke('agent:quick-launch', prompt),
  listAllAgents: () =>
    ipcRenderer.invoke('agent:list-all'),
  deleteAgentSession: (agentId) =>
    ipcRenderer.invoke('agent:delete-session', agentId),
  launchCloudAgent: (intentId, prompt) =>
    ipcRenderer.invoke('agent:launch-cloud', intentId, prompt),
  getCloudJobStatus: (agentId) =>
    ipcRenderer.invoke('agent:cloud-status', agentId),
  getAgentHistory: (agentId) =>
    ipcRenderer.invoke('agent:get-history', agentId),
  getAgentWorkingDir: (agentId) =>
    ipcRenderer.invoke('agent:get-working-dir', agentId),

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
  onLoadCanvasTarget: (callback) => {
    ipcRenderer.on('canvas-window:load-target', (_event: unknown, target: CanvasTarget) => callback(target));
  },
  onCanvasWindowClosed: (callback) => {
    ipcRenderer.on('canvas-window:closed', callback);
  },
  notifyCanvasThemeChanged: (theme) => ipcRenderer.send('canvas-window:theme-changed', theme),
  onCanvasThemeChanged: (callback) => {
    ipcRenderer.on('canvas-window:theme-changed', (_event: unknown, theme: string) => callback(theme));
  },

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
  onAgentCompleted: (callback) => {
    ipcRenderer.on('agent:completed', (_event: unknown, data: IpcEventPayload<'agent:completed'>) => callback(data));
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

  // ── Intent events ────────────────────────────────────────
  onIntentProcessed: (callback) => {
    ipcRenderer.on('intent:processed', (_event: unknown, id: string) => callback(id));
  },
  onRecurrenceResult: (callback) => {
    ipcRenderer.on('intent:recurrence', (_event: unknown, intentId: string, result: RecurrenceResult) => callback(intentId, result));
  },
  onRecurrenceApplied: (callback) => {
    ipcRenderer.on('intent:recurrence-applied', (_event: unknown, intentId: string) => callback(intentId));
  },
  onRecallHint: (callback) => {
    ipcRenderer.on('intent:recall', (_event: unknown, intentId: string, match: RecallMatch) => callback(intentId, match));
  },

  // ── Skills ──────────────────────────────────────────────
  listSkills: () => ipcRenderer.invoke('skill:list'),
  readSkill: (skillId) => ipcRenderer.invoke('skill:read', skillId),
  writeSkill: (skillId, frontmatter, body) => ipcRenderer.invoke('skill:write', skillId, frontmatter, body),
  createSkill: (name) => ipcRenderer.invoke('skill:create', name),
  createSkillFromPrompt: (description) => ipcRenderer.invoke('skill:create-from-prompt', description),
  deleteSkill: (skillId) => ipcRenderer.invoke('skill:delete', skillId),
  openSkillFolder: (skillId) => ipcRenderer.invoke('skill:open-folder', skillId),
  createIntentFromSkill: (skillId) => ipcRenderer.invoke('skill:create-intent', skillId),
  launchSkill: (skillId) => ipcRenderer.invoke('skill:launch', skillId),
  onSkillsChanged: (callback) => {
    ipcRenderer.on('skills:changed', callback);
  },

  // ── Platform ─────────────────────────────────────────────
  getPlatform: () => process.platform,
};

contextBridge.exposeInMainWorld('intentAPI', api);

// Expose platform info so the renderer can apply platform-adaptive styling
contextBridge.exposeInMainWorld('__platform', process.platform);
