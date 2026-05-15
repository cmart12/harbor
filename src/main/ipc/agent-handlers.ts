import { ipcMain } from 'electron';
import { isInitialized, getSpace } from '../database';
import { getConfigValue } from '../config';
import { notifyAllWindows } from '../notify';

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:launch', async (_event, spaceId: string, selectedText: string, anchor: any, options?: { repo?: string; model?: string }) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space || !space.folder) return { error: 'space_not_found' };

    const { launchAgent } = await import('../agent-service');
    return launchAgent(spaceId, selectedText, anchor, workspace, space.folder, options);
  });

  ipcMain.handle('agent:launch-from-comment', async (_event, spaceId: string, commentBody: string, quotedText: string, anchor: any, personaHandle: string, threadId: string | null) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space || !space.folder) return { error: 'space_not_found' };

    const allPersonas = getConfigValue('personas') || [];
    const persona = allPersonas.find(p => p.handle === personaHandle);
    if (!persona) return { error: 'persona_not_found' };

    // Route to cloud if persona is configured for cloud execution
    if (persona.runLocation === 'cloud') {
      const prompt = `${persona.instructions}\n\nComment: "${commentBody}"\nOn text: "${quotedText}"`;
      const { getWorkspaceRepo, getGitHubToken, launchCloudAgent } = await import('../cloud-agent');
      const repoInfo = await getWorkspaceRepo(workspace);
      if (!repoInfo) return { error: 'Could not determine repository from workspace.' };

      const token = await getGitHubToken();
      if (!token) return { error: 'No GitHub token found.' };

      const result = await launchCloudAgent(repoInfo.owner, repoInfo.repo, prompt, token);
      if ('error' in result) return result;

      const { v4: uuid } = await import('uuid');
      const agentId = uuid();
      const now = new Date().toISOString();
      const { createAgentSession } = await import('../database');
      createAgentSession({
        id: agentId, session_id: result.sessionId, space_id: spaceId,
        prompt: commentBody, status: 'running', summary: `Cloud job ${result.jobId}`,
        working_dir: workspace, source: 'cloud' as any, persona_handle: persona.handle,
        quoted_text: quotedText || null, created_at: now, updated_at: now,
      });

      const { startCloudJobPoller } = await import('../cloud-agent-poller');
      startCloudJobPoller(agentId, repoInfo.owner, repoInfo.repo, result.jobId, token);
      notifyAllWindows('agent:status-changed', { agentId, status: 'running' });

      return { agentId, sessionId: result.sessionId };
    }

    const { launchCommentAgent } = await import('../agent-service');
    return launchCommentAgent(spaceId, commentBody, quotedText, anchor, persona, threadId, workspace, space.folder);
  });

  ipcMain.handle('agent:list', async (_event, spaceId: string) => {
    const { listAgents } = await import('../agent-service');
    return listAgents(spaceId);
  });

  ipcMain.handle('agent:approve', async (_event, agentId: string, requestId: string, approved: boolean) => {
    // Route conduit agents to conduit-specific approval
    const { getAgentSession } = await import('../database');
    const session = getAgentSession(agentId);
    if (session?.source === 'conduit') {
      const { approveConduitPermission } = await import('../agent-service');
      approveConduitPermission(agentId, requestId, approved);
      return;
    }
    const { approveAgent } = await import('../agent-service');
    approveAgent(agentId, requestId, approved);
  });

  ipcMain.handle('agent:respond-user-input', async (_event, agentId: string, requestId: string, answer: string, wasFreeform: boolean) => {
    const { respondToUserInput } = await import('../agent-service');
    respondToUserInput(agentId, requestId, answer, wasFreeform);
  });

  ipcMain.handle('agent:respond-elicitation', async (_event, agentId: string, requestId: string, action: string, content?: Record<string, unknown>) => {
    const { respondToElicitation } = await import('../agent-service');
    respondToElicitation(agentId, requestId, action as 'accept' | 'decline' | 'cancel', content);
  });

  ipcMain.handle('agent:resolve-sandbox', async (_event, agentId: string, requestId: string, decision: string) => {
    if (decision !== 'allow-once' && decision !== 'allow-for-session' && decision !== 'disable') {
      return { error: 'invalid decision' };
    }
    const { resolveSandboxBlock } = await import('../agent-service');
    await resolveSandboxBlock(agentId, requestId, decision);
    return { ok: true };
  });

  ipcMain.handle('agent:abort', async (_event, agentId: string) => {
    // Route conduit agents to conduit-specific abort
    const { getAgentSession } = await import('../database');
    const session = getAgentSession(agentId);
    if (session?.source === 'conduit') {
      const { abortConduitAgent } = await import('../agent-service');
      await abortConduitAgent(agentId);
      return;
    }
    const { abortAgent } = await import('../agent-service');
    await abortAgent(agentId);
  });

  ipcMain.handle('agent:open-cli', async (_event, agentId: string) => {
    // Route conduit agents to conduit-specific CLI opener
    const { getAgentSession } = await import('../database');
    const session = getAgentSession(agentId);
    if (session?.source === 'conduit') {
      const { openConduitAgentCli } = await import('../agent-service');
      return openConduitAgentCli(agentId);
    }
    const { openAgentCli } = await import('../agent-service');
    return openAgentCli(agentId);
  });

  ipcMain.handle('agent:quick-launch', async (_event, prompt: string, personaHandle?: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace) return { error: 'no_workspace' };

    // Resolve persona (if any) before launching so cloud routing can be
    // applied appropriately.  Sandboxed personas are allowed: launchQuickAgent
    // applies their sandbox policy rooted at the workspace root, see
    // src/main/agents/sandbox-launch.ts.
    let persona: any = null;
    if (personaHandle) {
      const allPersonas = (getConfigValue('personas') as any[]) || [];
      persona = allPersonas.find(p => p.handle === personaHandle) || null;
      if (!persona) return { error: `Persona @${personaHandle} not found` };
    }

    if (persona && persona.runLocation === 'cloud') {
      const fullPrompt = `${persona.instructions}\n\n${prompt}`;
      const { getWorkspaceRepo, getGitHubToken, launchCloudAgent } = await import('../cloud-agent');
      const repoInfo = await getWorkspaceRepo(workspace);
      if (!repoInfo) return { error: 'Could not determine repository from workspace. Ensure a git remote is configured.' };

      const token = await getGitHubToken();
      if (!token) return { error: 'No GitHub token found. Run `gh auth login` or set GITHUB_TOKEN.' };

      const result = await launchCloudAgent(repoInfo.owner, repoInfo.repo, fullPrompt, token);
      if ('error' in result) return result;

      const { v4: uuid } = await import('uuid');
      const agentId = uuid();
      const now = new Date().toISOString();
      const summary = `Cloud job ${result.jobId} (@${persona.handle})`;
      const { createAgentSession } = await import('../database');
      createAgentSession({
        id: agentId,
        session_id: result.sessionId,
        space_id: null,
        prompt,
        status: 'running',
        summary,
        working_dir: workspace,
        source: 'cloud' as any,
        persona_handle: persona.handle,
        quoted_text: null,
        created_at: now,
        updated_at: now,
      });

      const { startCloudJobPoller } = await import('../cloud-agent-poller');
      startCloudJobPoller(agentId, repoInfo.owner, repoInfo.repo, result.jobId, token);
      notifyAllWindows('agent:status-changed', { agentId, status: 'running' });

      return { agentId, sessionId: result.sessionId };
    }

    // Route conduit personas to the Conduit runner
    if (persona && persona.runLocation === 'conduit') {
      const { launchConduitAgent } = await import('../agent-service');
      return launchConduitAgent(null, prompt, workspace, '', persona);
    }

    const { launchQuickAgent } = await import('../agent-service');
    return launchQuickAgent(prompt, workspace, persona ?? undefined);
  });

  ipcMain.handle('agent:launch-document', async (_event, spaceId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const space = getSpace(spaceId);
    if (!space || !space.folder) return { error: 'space_not_found' };

    const { launchDocumentAgent } = await import('../agent-service');
    return launchDocumentAgent(spaceId, workspace, space.folder);
  });

  ipcMain.handle('agent:list-all', async () => {
    const { listAllAgents } = await import('../agent-service');
    return listAllAgents();
  });

  ipcMain.handle('agent:delete-session', async (_event, agentId: string) => {
    const { abortAgent } = await import('../agent-service');
    try { await abortAgent(agentId); } catch { /* already stopped */ }
    const { deleteAgentSession } = await import('../database');
    deleteAgentSession(agentId);
    return { ok: true };
  });

  ipcMain.handle('agent:set-yolo', async (_event, agentId: string, enabled: boolean) => {
    const { setAgentYolo } = await import('../agent-service');
    return setAgentYolo(agentId, enabled);
  });

  // ── Remote control ──────────────────────────────────────
  ipcMain.handle('agent:enable-remote', async (_event, agentId: string) => {
    const { enableRemoteControl } = await import('../agent-service');
    return enableRemoteControl(agentId);
  });

  ipcMain.handle('agent:disable-remote', async (_event, agentId: string) => {
    const { disableRemoteControl } = await import('../agent-service');
    return disableRemoteControl(agentId);
  });

  // ── Cloud agent launch ────────────────────────────────────
  ipcMain.handle('agent:launch-cloud', async (_event, spaceId: string, prompt: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace) return { error: 'no_workspace' };

    const { getWorkspaceRepo, getGitHubToken, launchCloudAgent } = await import('../cloud-agent');
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
    const { createAgentSession } = await import('../database');
    createAgentSession({
      id: agentId,
      session_id: result.sessionId,
      space_id: spaceId || null,
      prompt,
      status: 'running',
      summary: `Cloud job ${result.jobId}`,
      working_dir: workspace,
      source: 'cloud' as any,
      persona_handle: null,
      quoted_text: null,
      created_at: now,
      updated_at: now,
    });

    // Start polling for this job
    const { startCloudJobPoller } = await import('../cloud-agent-poller');
    startCloudJobPoller(agentId, repoInfo.owner, repoInfo.repo, result.jobId, token);

    notifyAllWindows('agent:status-changed', { agentId, status: 'running' });

    return { agentId, sessionId: result.sessionId, jobId: result.jobId };
  });

  ipcMain.handle('agent:cloud-status', async (_event, agentId: string) => {
    const { getCloudJobPollResult } = await import('../cloud-agent-poller');
    return getCloudJobPollResult(agentId) || { status: 'unknown' };
  });

  // ── CLI session launch ──────────────────────────────────
  ipcMain.handle('cli:launch-session', async () => {
    const workspace = getConfigValue('workspace');
    if (!workspace) return { error: 'no_workspace' };

    const { launchCliSession } = await import('../agent-service');
    return launchCliSession(workspace);
  });

  // ── Agent history ───────────────────────────────────────
  ipcMain.handle('agent:get-history', async (_event, agentId: string) => {
    // Route conduit agents to conduit-specific history
    const { getAgentSession } = await import('../database');
    const session = getAgentSession(agentId);
    if (session?.source === 'conduit') {
      const { getConduitAgentHistory } = await import('../agent-service');
      return getConduitAgentHistory(agentId);
    }
    const { getAgentHistory } = await import('../agent-service');
    return getAgentHistory(agentId);
  });

  ipcMain.handle('agent:get-working-dir', async (_event, agentId: string) => {
    const { getAgentSession } = await import('../database');
    const session = getAgentSession(agentId);
    return session?.working_dir ?? null;
  });

  // ── Conduit agent handlers ─────────────────────────────

  ipcMain.handle('conduit:launch-agent', async (_event, spaceId: string, prompt: string, personaHandle?: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    // Support workspace-level agents (no space folder)
    let spaceFolder = '';
    if (spaceId && spaceId !== '__workspace__') {
      const space = getSpace(spaceId);
      if (!space || !space.folder) return { error: 'space_not_found' };
      spaceFolder = space.folder;
    }

    let persona;
    if (personaHandle) {
      const allPersonas = getConfigValue('personas') || [];
      persona = allPersonas.find(p => p.handle === personaHandle);
    }

    const { launchConduitAgent } = await import('../agent-service');
    return launchConduitAgent(spaceId, prompt, workspace, spaceFolder, persona);
  });

  ipcMain.handle('conduit:join-session', async (_event, conduitSessionId: string, spaceId: string) => {
    const { joinConduitSession } = await import('../agent-service');
    return joinConduitSession(conduitSessionId, spaceId);
  });

  ipcMain.handle('conduit:send-message', async (_event, agentId: string, prompt: string, attachments?: Array<{ type: string; [key: string]: unknown }>) => {
    const { sendConduitChatMessage } = await import('../agent-service');
    return sendConduitChatMessage(agentId, prompt, attachments);
  });

  ipcMain.handle('conduit:abort-agent', async (_event, agentId: string) => {
    const { abortConduitAgent } = await import('../agent-service');
    await abortConduitAgent(agentId);
    return { ok: true };
  });

  ipcMain.handle('conduit:disconnect-agent', async (_event, agentId: string) => {
    const { disconnectConduitAgent } = await import('../agent-service');
    await disconnectConduitAgent(agentId);
    return { ok: true };
  });

  ipcMain.handle('conduit:list-sessions', async () => {
    const { listConduitSessions } = await import('../agent-service');
    return listConduitSessions();
  });

  ipcMain.handle('conduit:host-status', async () => {
    const { getConduitHostStatus } = await import('../agent-service');
    return getConduitHostStatus();
  });

  ipcMain.handle('conduit:list-profiles', async () => {
    const { listConduitProfiles } = await import('../agent-service');
    return listConduitProfiles();
  });

  ipcMain.handle('conduit:set-profile', async (_event, profileId: string) => {
    const { setConfigValue: scv } = await import('../config');
    scv('conduitProfile', profileId || null);
    return { ok: true };
  });

  ipcMain.handle('conduit:list-profile-models', async (_event, profileId: string) => {
    const { getConduitHostClient } = await import('../conduit-client');
    const client = getConduitHostClient();
    if (!client) return { error: 'Conduit not configured' };
    try {
      const result = await client.listProfileModels(profileId);
      // Flatten to a simple model list
      const models: Array<{ id: string; name?: string; provider?: string }> = [];
      for (const group of result) {
        for (const m of group.models) {
          models.push({ id: m.id, name: m.name, provider: group.providerName });
        }
      }
      return models;
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('conduit:get-session-settings', async (_event, conduitSessionId: string) => {
    const { getConduitHostClient } = await import('../conduit-client');
    const client = getConduitHostClient();
    if (!client) return { error: 'Conduit not configured' };
    try {
      return await client.getSessionSettings(conduitSessionId);
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('conduit:update-session-settings', async (_event, conduitSessionId: string, settings: Record<string, unknown>) => {
    const { getConduitHostClient } = await import('../conduit-client');
    const client = getConduitHostClient();
    if (!client) return { error: 'Conduit not configured' };
    try {
      return await client.updateSessionSettings(conduitSessionId, settings);
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('conduit:update-session-profile', async (_event, conduitSessionId: string, profileId: string) => {
    const { getConduitHostClient } = await import('../conduit-client');
    const client = getConduitHostClient();
    if (!client) return { error: 'Conduit not configured' };
    try {
      await client.updateSessionProfile(conduitSessionId, profileId);
      return { ok: true };
    } catch (err: any) {
      return { error: err.message };
    }
  });

  ipcMain.handle('conduit:approve-permission', async (_event, agentId: string, requestId: string, approved: boolean) => {
    const { approveConduitPermission } = await import('../agent-service');
    approveConduitPermission(agentId, requestId, approved);
    return { ok: true };
  });

  ipcMain.handle('conduit:respond-input', async (_event, agentId: string, requestId: string, answer: string) => {
    const { respondToConduitUserInput } = await import('../agent-service');
    respondToConduitUserInput(agentId, requestId, answer);
    return { ok: true };
  });

  ipcMain.handle('conduit:get-session-clients', async (_event, sessionId: string) => {
    const { getConduitHostClient } = await import('../conduit-client');
    const client = getConduitHostClient();
    if (!client) return { error: 'Conduit not configured' };
    try {
      return await client.getSessionClients(sessionId);
    } catch (err: any) {
      return { error: err.message };
    }
  });
}
