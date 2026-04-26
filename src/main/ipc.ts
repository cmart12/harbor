import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as fs from 'fs';
import { isInitialized, createIntent, listIntents, updateIntent, deleteIntent, getIntent, logIntentEvent, listIntentEvents } from './database';
import { parseIntentWithAI, resolveDateWithAI, classifyInput, setAIModel, listAvailableModels } from './ai';
import { launchSession, getActiveSessionIntentIds, resolveCopilotCliPath, invalidateCliPath } from './session';
import { transcribeAudio } from './voice';
import { CreateIntentInput, Intent } from '../shared/types';
import { getConfigValue, setConfigValue, type AgentPersona } from './config';
import { initWorkspace, getDbPath, getLogPath, initIntentCanvas, readCanvas, writeCanvas, scheduleAutoCommit, saveAttachment, resolveAttachmentPath, getMimeType, getIntentHistory, restoreIntentVersion } from './workspace';
import { initDatabase, mergeSessionIds, assignIntentFolder, updateCanvasContent, searchIntents, syncCanvasContent } from './database';
import { getConfig } from './config';
import { listDiscoveredMcpServers } from './mcp';
import { validateMcpServers, validateCliTools } from './validators';
import { notifyAllWindows } from './notify';
import { fetchLinkPreview } from './services/link-preview';
import { handleRecurrence, dismissRecurrence, cancelPendingRecurrence } from './services/recurrence';
import { processIntentInBackground } from './services/intent-processing';

export { validateMcpServers, validateCliTools } from './validators';

export function registerIpcHandlers(): void {
  ipcMain.handle('intent:create', (_event, input: CreateIntentInput) => {
    if (!isInitialized()) return { error: 'no_workspace' };
    const intent = createIntent(input);

    // Eagerly create folder + canvas seeded with body
    const workspace = getConfigValue('workspace');
    if (workspace) {
      const folder = initIntentCanvas(workspace, intent.id, intent.description, intent.body);
      assignIntentFolder(intent.id, folder);
      intent.folder = folder;
      scheduleAutoCommit(workspace);
    }

    processIntentInBackground(intent.id, intent.body || intent.description, intent.updated_at);
    return intent;
  });

  ipcMain.handle('intent:list', () => {
    if (!isInitialized()) return [];
    return listIntents();
  });

  ipcMain.handle('intent:update', (_event, id: string, updates: Partial<Pick<Intent, 'description' | 'body' | 'client' | 'due_at' | 'due_at_utc' | 'status' | 'attachments'>>) => {
    // Detect transition to 'done' for recurrence evaluation
    if (updates.status === 'done') {
      const current = getIntent(id);
      if (current && current.status !== 'done') {
        // Real transition to done
        const completedAt = new Date().toISOString();
        const updated = updateIntent(id, { ...updates, completed_at: completedAt });
        if (updated) {
          logIntentEvent(id, 'completed', {
            due_at: updated.due_at,
            due_at_utc: updated.due_at_utc,
            completed_at: completedAt,
          });

          // If this is a dated intent, evaluate recurrence
          if (updated.due_at_utc || updated.due_at) {
            handleRecurrence(updated, updated.updated_at);
          }
        }
        return updated;
      }
    }

    // If body is being set (e.g., from canvas write-then-close), trigger AI refinement
    if (updates.body && updates.body.trim()) {
      const current = getIntent(id);
      if (current && (!current.description || current.description === '' || current.description === current.body)) {
        const updated = updateIntent(id, updates);
        if (updated) {
          processIntentInBackground(id, updates.body, updated.updated_at);
        }
        return updated;
      }
    }

    return updateIntent(id, updates);
  });

  ipcMain.handle('intent:delete', (_event, id: string) => {
    // Cancel any pending recurrence
    cancelPendingRecurrence(id);
    const result = deleteIntent(id);
    const workspace = getConfigValue('workspace');
    if (workspace) scheduleAutoCommit(workspace);
    return result;
  });

  ipcMain.handle('intent:dismiss-recurrence', (_event, id: string) => {
    dismissRecurrence(id);
    return true;
  });

  ipcMain.handle('voice:transcribe', async (_event, audioData: number[]) => {
    const float32 = new Float32Array(audioData);
    return transcribeAudio(float32);
  });

  // Settings — backed by local config.json
  ipcMain.handle('settings:get', (_event, key: string) => {
    const configKeyMap: Record<string, keyof ReturnType<typeof getConfig>> = {
      workspace_root: 'workspace',
      theme: 'theme',
      model: 'model',
      cli_path: 'cliPath',
    };
    const configKey = configKeyMap[key];
    if (configKey) return getConfigValue(configKey);
    return null;
  });

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    if (key === 'theme') {
      setConfigValue('theme', value as 'light' | 'dark');
    } else if (key === 'model') {
      setConfigValue('model', value);
      await setAIModel(value);
    } else if (key === 'cli_path') {
      setConfigValue('cliPath', value || null);
      invalidateCliPath();
    }
  });

  ipcMain.handle('cli:resolve-path', () => {
    return resolveCopilotCliPath();
  });

  ipcMain.handle('models:list', async () => {
    return listAvailableModels();
  });

  // Agent Personas
  const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

  ipcMain.handle('personas:list', () => {
    return getConfigValue('personas');
  });

  ipcMain.handle('personas:save', (_event, personas: unknown) => {
    if (!Array.isArray(personas)) return { error: 'invalid payload' };

    const seen = new Set<string>();
    const validated: AgentPersona[] = [];

    for (const p of personas) {
      if (!p || typeof p !== 'object') continue;
      const raw = p as Record<string, unknown>;

      const id = typeof raw.id === 'string' ? raw.id.trim() : '';
      const handle = typeof raw.handle === 'string'
        ? raw.handle.trim().replace(/^@/, '').toLowerCase()
        : '';
      const instructions = typeof raw.instructions === 'string'
        ? raw.instructions.trim().slice(0, 2000)
        : '';
      const model = typeof raw.model === 'string' ? raw.model.trim() : '';
      const runLocation = raw.runLocation === 'cloud' ? 'cloud' as const : 'local' as const;

      if (!id || !HANDLE_RE.test(handle) || !instructions) continue;
      if (seen.has(handle)) continue;
      seen.add(handle);

      validated.push({ id, handle, instructions, model, runLocation });
    }

    setConfigValue('personas', validated);
    return { ok: true };
  });

  // ── MCP Servers ──────────────────────────────────────────
  ipcMain.handle('mcp:list-discovered', () => {
    return listDiscoveredMcpServers();
  });

  ipcMain.handle('mcp:list-custom', () => {
    return getConfigValue('mcpServers') || [];
  });

  ipcMain.handle('mcp:save-custom', (_event, servers: unknown) => {
    const result = validateMcpServers(servers);
    if ('error' in result) return result;
    setConfigValue('mcpServers', result);
    return { ok: true };
  });

  // ── CLI Tool Definitions ─────────────────────────────────
  ipcMain.handle('cli-tools:list', () => {
    return getConfigValue('cliTools') || [];
  });

  ipcMain.handle('cli-tools:save', (_event, tools: unknown) => {
    const result = validateCliTools(tools);
    if ('error' in result) return result;
    setConfigValue('cliTools', result);
    return { ok: true };
  });

  // Intent events / timeline
  ipcMain.handle('intent:events', (_event, limit?: number) => {
    return listIntentEvents(limit || 100);
  });

  // Resolve natural language date
  ipcMain.handle('intent:resolve-date', async (_event, dateText: string) => {
    return resolveDateWithAI(dateText);
  });

  // Classify user input as intent vs query
  ipcMain.handle('intent:classify', async (_event, text: string) => {
    if (!isInitialized()) return { type: 'intent' };
    const allIntents = listIntents();
    const recent = allIntents.map(i => ({
      description: i.description,
      status: i.status,
      due_at: i.due_at,
      completed_at: i.completed_at,
    }));
    return classifyInput(text, recent);
  });

  // Summarize canvas content into a title
  ipcMain.handle('intent:summarize-title', async (_event, canvasContent: string) => {
    try {
      const parsed = await parseIntentWithAI(canvasContent);
      return { title: parsed.description };
    } catch (err) {
      console.error('[ipc] Summarize title failed:', err);
      return { title: null };
    }
  });

  // Session launch
  ipcMain.handle('session:launch', async (_event, intentId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !fs.existsSync(workspace)) {
      return { success: false, error: 'no_workspace' };
    }
    if (!isInitialized()) {
      return { success: false, error: 'no_workspace' };
    }
    return launchSession(intentId, workspace);
  });

  // Query which intents have active running terminal processes
  ipcMain.handle('session:active-intents', () => {
    return getActiveSessionIntentIds();
  });

  // Workspace directory picker — initializes workspace + DB on selection
  ipcMain.handle('workspace:select', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);

    // Suppress blur-hide while dialog is open
    if (win) {
      win.removeAllListeners('blur');
    }

    try {
      const result = await dialog.showOpenDialog({
        title: 'Select Workspace Directory',
        properties: ['openDirectory'],
        defaultPath: getConfigValue('workspace') || undefined,
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const dir = result.filePaths[0];
        setConfigValue('workspace', dir);

        // Initialize workspace structure and DB
        initWorkspace(dir);
        initDatabase(getDbPath(dir), getLogPath(dir));
        mergeSessionIds(getConfig().sessions);
        syncCanvasContent(dir);

        return { selected: true, path: dir };
      }
      return { selected: false, path: null };
    } finally {
      // Restore blur-hide behavior
      if (win) {
        const restoreTs = Date.now();
        win.on('blur', async () => {
          if (Date.now() - restoreTs < 300) return;
          try {
            const shouldStay = await win.webContents.executeJavaScript(
              `(function() {
                var input = document.getElementById('description-input');
                var hasInput = input && input.value.trim().length > 0;
                var canvasOpen = !document.getElementById('canvas-view').classList.contains('hidden');
                return hasInput || canvasOpen;
              })()`
            );
            if (shouldStay) return;
          } catch { /* hide on failure */ }
          win.hide();
        });
      }
    }
  });

  // Open a folder in the system file manager
  ipcMain.handle('shell:openPath', (_event, folderPath: string) => {
    return shell.openPath(folderPath);
  });

  // ── Canvas I/O ──────────────────────────────────────────
  ipcMain.handle('canvas:read', (_event, intentId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { content: '', error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent) return { content: '', error: 'not_found' };

    // Ensure folder exists (for intents created before canvas feature)
    let folder = intent.folder;
    if (!folder) {
      folder = initIntentCanvas(workspace, intentId, intent.description, intent.body);
      assignIntentFolder(intentId, folder);
    }

    return { content: readCanvas(workspace, folder) };
  });

  ipcMain.handle('canvas:write', (_event, intentId: string, content: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent) return { error: 'not_found' };

    let folder = intent.folder;
    if (!folder) {
      folder = initIntentCanvas(workspace, intentId, intent.description, intent.body);
      assignIntentFolder(intentId, folder);
    }

    writeCanvas(workspace, folder, content);
    updateCanvasContent(intentId, content);
    return { success: true };
  });

  // Save canvas + trigger a commit (called when leaving the canvas)
  ipcMain.handle('canvas:close', (_event, intentId: string, content: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return;

    const intent = getIntent(intentId);
    if (!intent) return;

    let folder = intent.folder;
    if (!folder) {
      folder = initIntentCanvas(workspace, intentId, intent.description, intent.body);
      assignIntentFolder(intentId, folder);
    }

    writeCanvas(workspace, folder, content);
    updateCanvasContent(intentId, content);
    scheduleAutoCommit(workspace);
  });

  ipcMain.handle('intent:search', (_event, query: string) => {
    if (!isInitialized()) return [];
    return searchIntents(query);
  });

  // ── Canvas file paste ─────────────────────────────────
  ipcMain.handle('canvas:paste-file', (_event, intentId: string, filename: string, dataArray: number[]) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent) return { error: 'not_found' };

    let folder = intent.folder;
    if (!folder) {
      folder = initIntentCanvas(workspace, intentId, intent.description, intent.body);
      assignIntentFolder(intentId, folder);
    }

    const data = Buffer.from(dataArray);
    const result = saveAttachment(workspace, folder, filename, data);
    return result;
  });

  // ── Attachment file serving ───────────────────────────
  ipcMain.handle('canvas:resolve-attachment', (_event, intentId: string, relativePath: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent || !intent.folder) return { error: 'not_found' };

    const absPath = resolveAttachmentPath(workspace, intent.folder, relativePath);
    if (!absPath) return { error: 'not_found' };

    const mimeType = getMimeType(absPath);
    return { path: absPath, mimeType };
  });

  // ── Link preview ──────────────────────────────────────
  ipcMain.handle('canvas:fetch-link-meta', async (_event, url: string) => {
    return fetchLinkPreview(url);
  });

  // ── Canvas history ──────────────────────────────────────
  ipcMain.handle('canvas:history', async (_event, intentId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { commits: [], error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent || !intent.folder) return { commits: [], error: 'not_found' };

    const commits = await getIntentHistory(workspace, intent.folder);
    return { commits };
  });

  ipcMain.handle('canvas:restore', async (_event, intentId: string, sha: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { success: false, error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent || !intent.folder) return { success: false, error: 'not_found' };

    const result = await restoreIntentVersion(workspace, intent.folder, sha);
    if (result.success) {
      // Re-read canvas and update DB
      const content = readCanvas(workspace, intent.folder);
      updateCanvasContent(intentId, content);
    }
    return result;
  });

  // ── Canvas agents (SDK-based) ────────────────────────────
  ipcMain.handle('agent:launch', async (_event, intentId: string, selectedText: string, anchor: any, options?: { repo?: string; model?: string }) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent || !intent.folder) return { error: 'intent_not_found' };

    const { launchAgent } = await import('./agent-service');
    return launchAgent(intentId, selectedText, anchor, workspace, intent.folder, options);
  });

  ipcMain.handle('agent:list', async (_event, intentId: string) => {
    const { listAgents } = await import('./agent-service');
    return listAgents(intentId);
  });

  ipcMain.handle('agent:approve', async (_event, agentId: string, requestId: string, approved: boolean) => {
    const { approveAgent } = await import('./agent-service');
    approveAgent(agentId, requestId, approved);
  });

  ipcMain.handle('agent:respond-user-input', async (_event, agentId: string, requestId: string, answer: string, wasFreeform: boolean) => {
    const { respondToUserInput } = await import('./agent-service');
    respondToUserInput(agentId, requestId, answer, wasFreeform);
  });

  ipcMain.handle('agent:respond-elicitation', async (_event, agentId: string, requestId: string, action: string, content?: Record<string, unknown>) => {
    const { respondToElicitation } = await import('./agent-service');
    respondToElicitation(agentId, requestId, action as 'accept' | 'decline' | 'cancel', content);
  });

  ipcMain.handle('agent:abort', async (_event, agentId: string) => {
    const { abortAgent } = await import('./agent-service');
    await abortAgent(agentId);
  });

  ipcMain.handle('agent:open-cli', async (_event, agentId: string) => {
    const { openAgentCli } = await import('./agent-service');
    return openAgentCli(agentId);
  });

  ipcMain.handle('agent:quick-launch', async (_event, prompt: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace) return { error: 'no_workspace' };

    const { launchQuickAgent } = await import('./agent-service');
    return launchQuickAgent(prompt, workspace);
  });

  ipcMain.handle('agent:list-all', async () => {
    const { listAllAgents } = await import('./agent-service');
    return listAllAgents();
  });

  ipcMain.handle('agent:delete-session', async (_event, agentId: string) => {
    const { abortAgent } = await import('./agent-service');
    try { await abortAgent(agentId); } catch { /* already stopped */ }
    const { deleteAgentSession } = await import('./database');
    deleteAgentSession(agentId);
    return { ok: true };
  });

  // ── Cloud agent launch ────────────────────────────────────
  ipcMain.handle('agent:launch-cloud', async (_event, intentId: string, prompt: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace) return { error: 'no_workspace' };

    const { getWorkspaceRepo, getGitHubToken, launchCloudAgent } = await import('./cloud-agent');
    const repoInfo = await getWorkspaceRepo(workspace);
    if (!repoInfo) return { error: 'Could not determine repository from workspace. Ensure a git remote is configured.' };

    const token = await getGitHubToken();
    if (!token) return { error: 'No GitHub token found. Run `gh auth login` or set GITHUB_TOKEN.' };

    const result = await launchCloudAgent(repoInfo.owner, repoInfo.repo, prompt, token);
    if ('error' in result) return result;

    // Register in agent_sessions DB for tracking
    const { v4: uuid } = await import('uuid');
    const agentId = uuid();
    const now = new Date().toISOString();
    const { createAgentSession } = await import('./database');
    createAgentSession({
      id: agentId,
      session_id: result.sessionId,
      intent_id: intentId || null,
      prompt,
      status: 'running',
      summary: `Cloud job ${result.jobId}`,
      working_dir: workspace,
      source: 'cloud' as any,
      created_at: now,
      updated_at: now,
    });

    // Start polling for this job
    const { startCloudJobPoller } = await import('./cloud-agent-poller');
    startCloudJobPoller(agentId, repoInfo.owner, repoInfo.repo, result.jobId, token);

    notifyAllWindows('agent:status-changed', { agentId, status: 'running' });

    return { agentId, sessionId: result.sessionId, jobId: result.jobId };
  });

  ipcMain.handle('agent:cloud-status', async (_event, agentId: string) => {
    const { getCloudJobPollResult } = await import('./cloud-agent-poller');
    return getCloudJobPollResult(agentId) || { status: 'unknown' };
  });

  // ── CLI session launch ──────────────────────────────────
  ipcMain.handle('cli:launch-session', async () => {
    const workspace = getConfigValue('workspace');
    if (!workspace) return { error: 'no_workspace' };

    const { launchCliSession } = await import('./agent-service');
    return launchCliSession(workspace);
  });

  // ── Agent history ───────────────────────────────────────
  ipcMain.handle('agent:get-history', async (_event, agentId: string) => {
    const { getAgentHistory } = await import('./agent-service');
    return getAgentHistory(agentId);
  });

  // ── Comment-triggered agent launch ───────────────────────
  ipcMain.handle('agent:launch-from-comment', async (_event, intentId: string, commentBody: string, quotedText: string, anchor: any, personaHandle: string, threadIndex: number) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent || !intent.folder) return { error: 'intent_not_found' };

    const allPersonas = getConfigValue('personas') || [];
    const persona = allPersonas.find(p => p.handle === personaHandle);
    if (!persona) return { error: 'persona_not_found' };

    // Route to cloud if persona is configured for cloud execution
    if (persona.runLocation === 'cloud') {
      const prompt = `${persona.instructions}\n\nComment: "${commentBody}"\nOn text: "${quotedText}"`;
      // Reuse the cloud launch handler
      const { getWorkspaceRepo, getGitHubToken, launchCloudAgent } = await import('./cloud-agent');
      const repoInfo = await getWorkspaceRepo(workspace);
      if (!repoInfo) return { error: 'Could not determine repository from workspace.' };

      const token = await getGitHubToken();
      if (!token) return { error: 'No GitHub token found.' };

      const result = await launchCloudAgent(repoInfo.owner, repoInfo.repo, prompt, token);
      if ('error' in result) return result;

      const { v4: uuid } = await import('uuid');
      const agentId = uuid();
      const now = new Date().toISOString();
      const { createAgentSession } = await import('./database');
      createAgentSession({
        id: agentId, session_id: result.sessionId, intent_id: intentId,
        prompt: commentBody, status: 'running', summary: `Cloud job ${result.jobId}`,
        working_dir: workspace, source: 'cloud' as any, created_at: now, updated_at: now,
      });

      const { startCloudJobPoller } = await import('./cloud-agent-poller');
      startCloudJobPoller(agentId, repoInfo.owner, repoInfo.repo, result.jobId, token);
      notifyAllWindows('agent:status-changed', { agentId, status: 'running' });

      return { agentId, sessionId: result.sessionId };
    }

    const { launchCommentAgent } = await import('./agent-service');
    return launchCommentAgent(intentId, commentBody, quotedText, anchor, persona, threadIndex, workspace, intent.folder);
  });

  // ── Chat (in-app agent conversation) ────────────────────
  ipcMain.handle('chat:send-message', async (_event, agentId: string, prompt: string, attachments?: Array<{ type: 'file'; path: string }>) => {
    const { sendChatMessage } = await import('./agent-service');
    return sendChatMessage(agentId, prompt, attachments);
  });

  ipcMain.handle('chat:set-model', async (_event, agentId: string, model: string) => {
    const { setAgentModel } = await import('./agent-service');
    return setAgentModel(agentId, model);
  });

  // ── Sub-agent tracking ─────────────────────────────────
  ipcMain.handle('subagent:list', async (_event, parentAgentId: string) => {
    const { subagentTracker } = await import('./agent-service');
    return subagentTracker.listSubagents(parentAgentId);
  });

  ipcMain.handle('subagent:read', async (_event, parentAgentId: string, agentId: string) => {
    const { subagentTracker } = await import('./agent-service');
    return subagentTracker.getSubagent(parentAgentId, agentId) ?? null;
  });

  ipcMain.handle('subagent:write', async (_event, _parentAgentId: string, _agentId: string, _message: string) => {
    // Requires SDK support — stub for now
    return { success: false, error: 'Not yet supported' };
  });

  ipcMain.handle('subagent:cancel', async (_event, _parentAgentId: string, _agentId: string) => {
    // Requires SDK support — stub for now
    return { success: false, error: 'Not yet supported' };
  });
}
