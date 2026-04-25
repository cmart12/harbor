import { ipcMain, BrowserWindow, dialog, shell } from 'electron';
import * as fs from 'fs';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { isInitialized, createIntent, listIntents, updateIntent, updateIntentCAS, deleteIntent, getIntent, logIntentEvent, listIntentEvents } from './database';
import { parseIntentWithAI, evaluateRecurrence, findSimilarIntent, resolveDateWithAI, classifyInput, setAIModel, listAvailableModels } from './ai';
import { launchSession, getActiveSessionIntentIds, resolveCopilotCliPath, invalidateCliPath } from './session';
import { transcribeAudio } from './voice';
import { CreateIntentInput, Intent, RecurrenceResult, LinkPreviewMeta } from '../shared/types';
import { getConfigValue, setConfigValue, type AgentPersona, type CliToolDefinition, type CustomMcpServer } from './config';
import { initWorkspace, getDbPath, getLogPath, initIntentCanvas, readCanvas, writeCanvas, scheduleAutoCommit, saveAttachment, resolveAttachmentPath, getMimeType } from './workspace';
import { initDatabase, mergeSessionIds, assignIntentFolder, updateCanvasContent, searchIntents, syncCanvasContent, updateCanvasAgentStatus } from './database';
import { getConfig } from './config';
import { listDiscoveredMcpServers } from './mcp';

// Track in-flight recurrence evaluations so we can cancel them
const pendingRecurrences = new Map<string, { result: RecurrenceResult; version: string; timer: ReturnType<typeof setTimeout> }>();

function notifyAllWindows(channel: string, ...args: any[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

async function processIntentInBackground(id: string, body: string, createdVersion: string): Promise<void> {
  try {
    const parsed = await parseIntentWithAI(body);
    // CAS: only apply AI results if intent hasn't been edited since creation
    updateIntentCAS(id, createdVersion, {
      description: parsed.description,
      client: parsed.client,
      due_at: parsed.due_at,
      due_at_utc: parsed.due_at_utc,
    });
    notifyAllWindows('intent:processed', id);

    const workspace = getConfigValue('workspace');
    if (workspace) scheduleAutoCommit(workspace);

    // After refinement, search for similar past intents (recall)
    searchForRecall(id, parsed.description);
  } catch (err) {
    console.error('[ipc] Background intent processing failed:', err);
  }
}

async function searchForRecall(intentId: string, description: string): Promise<void> {
  try {
    const allIntents = listIntents();
    // Exclude the intent itself, get recent ones (last 30)
    const candidates = allIntents
      .filter(i => i.id !== intentId)
      .slice(0, 30);

    if (candidates.length === 0) return;

    // Prefilter: simple word overlap scoring to narrow to top 8
    const words = new Set(description.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const scored = candidates.map(c => {
      const cWords = (c.description || '').toLowerCase().split(/\s+/);
      const overlap = cWords.filter(w => words.has(w)).length;
      return { intent: c, overlap };
    });
    scored.sort((a, b) => b.overlap - a.overlap);
    const topCandidates = scored.slice(0, 8).map(s => s.intent);

    if (topCandidates.length === 0) return;

    const match = await findSimilarIntent(description, topCandidates);
    if (match) {
      notifyAllWindows('intent:recall', intentId, match);
    }
  } catch (err) {
    console.error('[ipc] Recall search failed:', err);
  }
}

async function handleRecurrence(intent: Intent, version: string): Promise<void> {
  try {
    const result = await evaluateRecurrence({
      raw_text: intent.raw_text,
      description: intent.description,
      due_at: intent.due_at,
      due_at_utc: intent.due_at_utc,
      completed_at: intent.completed_at!,
    });

    if (!result.should_recur) {
      notifyAllWindows('intent:recurrence', intent.id, result);
      return;
    }

    // Send result to renderer immediately for preview
    notifyAllWindows('intent:recurrence', intent.id, result);

    // Start undo window — apply recurrence after 5 seconds
    const timer = setTimeout(() => {
      applyRecurrence(intent.id, version, result);
      pendingRecurrences.delete(intent.id);
    }, 5000);

    pendingRecurrences.set(intent.id, { result, version, timer });
  } catch (err) {
    console.error('[ipc] Recurrence evaluation failed:', err);
  }
}

function applyRecurrence(intentId: string, expectedVersion: string, result: RecurrenceResult): void {
  const updated = updateIntentCAS(intentId, expectedVersion, {
    status: 'captured',
    due_at: result.next_due,
    due_at_utc: result.next_due_utc,
    recurrence: JSON.stringify(result),
  });

  if (updated) {
    const current = getIntent(intentId);
    logIntentEvent(intentId, 'recycled', {
      due_at: result.next_due,
      due_at_utc: result.next_due_utc,
      recurrence_json: JSON.stringify(result),
    });
    notifyAllWindows('intent:recurrence-applied', intentId);
    console.log(`[ipc] Recurrence applied for ${intentId}: next due ${result.next_due}`);
  } else {
    console.log(`[ipc] Recurrence CAS failed for ${intentId} — intent was modified`);
  }
}

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
    const pending = pendingRecurrences.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRecurrences.delete(id);
    }
    const result = deleteIntent(id);
    const workspace = getConfigValue('workspace');
    if (workspace) scheduleAutoCommit(workspace);
    return result;
  });

  ipcMain.handle('intent:dismiss-recurrence', (_event, id: string) => {
    const pending = pendingRecurrences.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingRecurrences.delete(id);
      logIntentEvent(id, 'recurrence_dismissed', {
        recurrence_json: JSON.stringify(pending.result),
      });
      console.log(`[ipc] Recurrence dismissed for ${id}`);
    }
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

      if (!id || !HANDLE_RE.test(handle) || !instructions) continue;
      if (seen.has(handle)) continue;
      seen.add(handle);

      validated.push({ id, handle, instructions, model });
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
    if (!Array.isArray(servers)) return { error: 'invalid payload' };

    const validated: CustomMcpServer[] = [];
    const seen = new Set<string>();

    for (const s of servers) {
      if (!s || typeof s !== 'object') continue;
      const raw = s as Record<string, unknown>;

      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      const type = typeof raw.type === 'string' && ['stdio', 'http', 'sse'].includes(raw.type) ? raw.type as 'stdio' | 'http' | 'sse' : 'stdio';
      const command = typeof raw.command === 'string' ? raw.command.trim() : undefined;
      const args = Array.isArray(raw.args) ? raw.args.filter((a: unknown) => typeof a === 'string') as string[] : [];
      const url = typeof raw.url === 'string' ? raw.url.trim() : undefined;
      const tools = Array.isArray(raw.tools) ? raw.tools.filter((t: unknown) => typeof t === 'string') as string[] : ['*'];

      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);

      if (type === 'stdio' && !command) continue;
      if ((type === 'http' || type === 'sse') && !url) continue;

      validated.push({ name, type, command, args, url, tools });
    }

    setConfigValue('mcpServers', validated);
    return { ok: true };
  });

  // ── CLI Tool Definitions ─────────────────────────────────
  ipcMain.handle('cli-tools:list', () => {
    return getConfigValue('cliTools') || [];
  });

  ipcMain.handle('cli-tools:save', (_event, tools: unknown) => {
    if (!Array.isArray(tools)) return { error: 'invalid payload' };

    const validated: CliToolDefinition[] = [];
    const seen = new Set<string>();

    for (const t of tools) {
      if (!t || typeof t !== 'object') continue;
      const raw = t as Record<string, unknown>;

      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      const description = typeof raw.description === 'string' ? raw.description.trim().slice(0, 500) : '';

      if (!name || !description) continue;
      if (seen.has(name)) continue;
      seen.add(name);

      validated.push({ name, description });
    }

    setConfigValue('cliTools', validated);
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
}

// ── Link preview fetching ─────────────────────────────────

const linkPreviewCache = new Map<string, { meta: LinkPreviewMeta; ts: number }>();
const LINK_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function fetchLinkPreview(urlStr: string): Promise<LinkPreviewMeta> {
  // Check cache
  const cached = linkPreviewCache.get(urlStr);
  if (cached && Date.now() - cached.ts < LINK_CACHE_TTL) {
    return cached.meta;
  }

  const result: LinkPreviewMeta = {
    url: urlStr,
    title: null,
    description: null,
    image: null,
    favicon: null,
  };

  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return result;
    }

    // Block private/local addresses
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' ||
        hostname.startsWith('10.') || hostname.startsWith('192.168.') ||
        hostname.startsWith('172.') || hostname.endsWith('.local')) {
      return result;
    }

    const html = await fetchUrl(urlStr, 8000, 100 * 1024); // 8s timeout, 100KB max
    if (!html) return result;

    // Extract OG meta tags
    result.title = extractMeta(html, 'og:title') || extractTitle(html);
    result.description = extractMeta(html, 'og:description') || extractMeta(html, 'description');
    result.image = extractMeta(html, 'og:image');
    result.favicon = `${parsed.protocol}//${parsed.host}/favicon.ico`;

    linkPreviewCache.set(urlStr, { meta: result, ts: Date.now() });
  } catch (err) {
    console.error('[ipc] Link preview fetch failed:', err);
  }

  return result;
}

function fetchUrl(urlStr: string, timeout: number, maxBytes: number): Promise<string | null> {
  return new Promise((resolve) => {
    const parsed = new URL(urlStr);
    const mod = parsed.protocol === 'https:' ? https : http;

    const req = mod.get(urlStr, { timeout, headers: { 'User-Agent': 'Intent-LinkPreview/1.0' } }, (res) => {
      // Follow one redirect
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        req.destroy();
        fetchUrl(res.headers.location, timeout, maxBytes).then(resolve);
        return;
      }

      if (res.statusCode !== 200) {
        req.destroy();
        resolve(null);
        return;
      }

      let data = '';
      let bytes = 0;
      res.setEncoding('utf-8');
      res.on('data', (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxBytes) {
          res.destroy();
          return;
        }
        data += chunk;
      });
      res.on('end', () => resolve(data));
      res.on('error', () => resolve(null));
    });

    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

function extractMeta(html: string, property: string): string | null {
  // Try og: property first, then name
  const ogRegex = new RegExp(`<meta[^>]+(?:property|name)=["']${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]+content=["']([^"']+)["']`, 'i');
  const match = ogRegex.exec(html);
  if (match) return match[1];

  // Try reversed attribute order
  const revRegex = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
  const revMatch = revRegex.exec(html);
  return revMatch ? revMatch[1] : null;
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match ? match[1].trim() : null;
}
