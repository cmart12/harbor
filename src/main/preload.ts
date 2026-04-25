const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('intentAPI', {
  create: (input: { body: string }) =>
    ipcRenderer.invoke('intent:create', input),
  list: () => ipcRenderer.invoke('intent:list'),
  update: (id: string, updates: Record<string, unknown>) =>
    ipcRenderer.invoke('intent:update', id, updates),
  delete: (id: string) => ipcRenderer.invoke('intent:delete', id),
  dismissRecurrence: (id: string) => ipcRenderer.invoke('intent:dismiss-recurrence', id),
  transcribe: (audioData: number[]) => ipcRenderer.invoke('voice:transcribe', audioData),
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  resolveCliPath: () => ipcRenderer.invoke('cli:resolve-path'),
  listModels: () => ipcRenderer.invoke('models:list'),
  listPersonas: () => ipcRenderer.invoke('personas:list'),
  savePersonas: (personas: any[]) => ipcRenderer.invoke('personas:save', personas),

  // MCP servers
  listDiscoveredMcp: () => ipcRenderer.invoke('mcp:list-discovered'),
  listCustomMcp: () => ipcRenderer.invoke('mcp:list-custom'),
  saveCustomMcp: (servers: any[]) => ipcRenderer.invoke('mcp:save-custom', servers),

  // CLI tool definitions
  listCliTools: () => ipcRenderer.invoke('cli-tools:list'),
  saveCliTools: (tools: any[]) => ipcRenderer.invoke('cli-tools:save', tools),

  listEvents: (limit?: number) => ipcRenderer.invoke('intent:events', limit),
  resolveDate: (dateText: string) => ipcRenderer.invoke('intent:resolve-date', dateText),
  classifyInput: (text: string) => ipcRenderer.invoke('intent:classify', text),
  launchSession: (intentId: string) => ipcRenderer.invoke('session:launch', intentId),
  getActiveSessions: () => ipcRenderer.invoke('session:active-intents'),
  selectWorkspace: () => ipcRenderer.invoke('workspace:select'),
  openPath: (folderPath: string) => ipcRenderer.invoke('shell:openPath', folderPath),
  readCanvas: (intentId: string) => ipcRenderer.invoke('canvas:read', intentId),
  writeCanvas: (intentId: string, content: string) => ipcRenderer.invoke('canvas:write', intentId, content),
  closeCanvas: (intentId: string, content: string) => ipcRenderer.invoke('canvas:close', intentId, content),
  canvasHistory: (intentId: string) => ipcRenderer.invoke('canvas:history', intentId),
  canvasRestore: (intentId: string, sha: string) => ipcRenderer.invoke('canvas:restore', intentId, sha),
  searchIntents: (query: string) => ipcRenderer.invoke('intent:search', query),
  summarizeTitle: (canvasContent: string) => ipcRenderer.invoke('intent:summarize-title', canvasContent),

  // Canvas enhancements
  pasteFile: (intentId: string, filename: string, dataArray: number[]) =>
    ipcRenderer.invoke('canvas:paste-file', intentId, filename, dataArray),

  // Agent operations
  launchAgent: (intentId: string, selectedText: string, anchor: any, options?: { repo?: string; model?: string }) =>
    ipcRenderer.invoke('agent:launch', intentId, selectedText, anchor, options),
  launchCommentAgent: (intentId: string, commentBody: string, quotedText: string, anchor: any, personaHandle: string, threadIndex: number) =>
    ipcRenderer.invoke('agent:launch-from-comment', intentId, commentBody, quotedText, anchor, personaHandle, threadIndex),
  listAgents: (intentId: string) =>
    ipcRenderer.invoke('agent:list', intentId),
  approveAgent: (agentId: string, requestId: string, approved: boolean) =>
    ipcRenderer.invoke('agent:approve', agentId, requestId, approved),
  abortAgent: (agentId: string) =>
    ipcRenderer.invoke('agent:abort', agentId),
  openAgentCli: (agentId: string) =>
    ipcRenderer.invoke('agent:open-cli', agentId),
  quickLaunchAgent: (prompt: string) =>
    ipcRenderer.invoke('agent:quick-launch', prompt),
  listAllAgents: () =>
    ipcRenderer.invoke('agent:list-all'),

  // Chat (in-app agent conversation)
  sendChatMessage: (agentId: string, prompt: string, attachments?: Array<{ type: 'file'; path: string }>) =>
    ipcRenderer.invoke('chat:send-message', agentId, prompt, attachments),
  setChatModel: (agentId: string, model: string) =>
    ipcRenderer.invoke('chat:set-model', agentId, model),
  onChatEvent: (agentId: string, callback: (event: any) => void) => {
    const channel = `chat:event:${agentId}`;
    const handler = (_event: any, data: any) => callback(data);
    ipcRenderer.on(channel, handler);
    return () => { ipcRenderer.removeListener(channel, handler); };
  },

  hideWindow: () => ipcRenderer.send('window:hide'),
  expandWindow: () => ipcRenderer.send('window:expand'),
  collapseWindow: () => ipcRenderer.send('window:collapse'),
  getPinned: () => ipcRenderer.invoke('window:get-pinned'),
  setPinned: (pinned: boolean) => ipcRenderer.send('window:set-pinned', pinned),
  onPinnedChanged: (callback: (pinned: boolean) => void) => {
    ipcRenderer.on('window:pinned-changed', (_event: any, pinned: boolean) => callback(pinned));
  },
  onWindowShown: (callback: () => void) => {
    ipcRenderer.on('window:shown', callback);
  },
  onWindowToggle: (callback: () => void) => {
    ipcRenderer.on('window:toggle', callback);
  },
  onWorkspaceCommitted: (callback: () => void) => {
    ipcRenderer.on('workspace:committed', callback);
  },
  onAgentStatusChanged: (callback: (data: any) => void) => {
    ipcRenderer.on('agent:status-changed', (_event: any, data: any) => callback(data));
  },
  onAgentApprovalNeeded: (callback: (data: any) => void) => {
    ipcRenderer.on('agent:approval-needed', (_event: any, data: any) => callback(data));
  },
  onAgentCompleted: (callback: (data: any) => void) => {
    ipcRenderer.on('agent:completed', (_event: any, data: any) => callback(data));
  },
  onAgentPresenceStarted: (callback: (data: any) => void) => {
    ipcRenderer.on('agent:presence-started', (_event: any, data: any) => callback(data));
  },
  onAgentPresenceEnded: (callback: (data: any) => void) => {
    ipcRenderer.on('agent:presence-ended', (_event: any, data: any) => callback(data));
  },
  onAgentReplyReady: (callback: (data: any) => void) => {
    ipcRenderer.on('agent:reply-ready', (_event: any, data: any) => callback(data));
  },
  onIntentProcessed: (callback: (id: string) => void) => {
    ipcRenderer.on('intent:processed', (_event: any, id: string) => callback(id));
  },
  onRecurrenceResult: (callback: (intentId: string, result: any) => void) => {
    ipcRenderer.on('intent:recurrence', (_event: any, intentId: string, result: any) => callback(intentId, result));
  },
  onRecurrenceApplied: (callback: (intentId: string) => void) => {
    ipcRenderer.on('intent:recurrence-applied', (_event: any, intentId: string) => callback(intentId));
  },
  onRecallHint: (callback: (intentId: string, match: any) => void) => {
    ipcRenderer.on('intent:recall', (_event: any, intentId: string, match: any) => callback(intentId, match));
  },
});
