import { ipcMain } from 'electron';
import { isInitialized, getIntent } from '../database';
import { getConfigValue } from '../config';
import { notifyAllWindows } from '../notify';

export function registerAgentHandlers(): void {
  ipcMain.handle('agent:launch', async (_event, intentId: string, selectedText: string, anchor: any, options?: { repo?: string; model?: string }) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent || !intent.folder) return { error: 'intent_not_found' };

    const { launchAgent } = await import('../agent-service');
    return launchAgent(intentId, selectedText, anchor, workspace, intent.folder, options);
  });

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
        id: agentId, session_id: result.sessionId, intent_id: intentId,
        prompt: commentBody, status: 'running', summary: `Cloud job ${result.jobId}`,
        working_dir: workspace, source: 'cloud' as any, persona_handle: persona.handle, created_at: now, updated_at: now,
      });

      const { startCloudJobPoller } = await import('../cloud-agent-poller');
      startCloudJobPoller(agentId, repoInfo.owner, repoInfo.repo, result.jobId, token);
      notifyAllWindows('agent:status-changed', { agentId, status: 'running' });

      return { agentId, sessionId: result.sessionId };
    }

    const { launchCommentAgent } = await import('../agent-service');
    return launchCommentAgent(intentId, commentBody, quotedText, anchor, persona, threadIndex, workspace, intent.folder);
  });

  ipcMain.handle('agent:list', async (_event, intentId: string) => {
    const { listAgents } = await import('../agent-service');
    return listAgents(intentId);
  });

  ipcMain.handle('agent:approve', async (_event, agentId: string, requestId: string, approved: boolean) => {
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
    const { abortAgent } = await import('../agent-service');
    await abortAgent(agentId);
  });

  ipcMain.handle('agent:open-cli', async (_event, agentId: string) => {
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
        intent_id: null,
        prompt,
        status: 'running',
        summary,
        working_dir: workspace,
        source: 'cloud' as any,
        persona_handle: persona.handle,
        created_at: now,
        updated_at: now,
      });

      const { startCloudJobPoller } = await import('../cloud-agent-poller');
      startCloudJobPoller(agentId, repoInfo.owner, repoInfo.repo, result.jobId, token);
      notifyAllWindows('agent:status-changed', { agentId, status: 'running' });

      return { agentId, sessionId: result.sessionId };
    }

    const { launchQuickAgent } = await import('../agent-service');
    return launchQuickAgent(prompt, workspace, persona ?? undefined);
  });

  ipcMain.handle('agent:launch-document', async (_event, intentId: string) => {
    const workspace = getConfigValue('workspace');
    if (!workspace || !isInitialized()) return { error: 'no_workspace' };

    const intent = getIntent(intentId);
    if (!intent || !intent.folder) return { error: 'intent_not_found' };

    const { launchDocumentAgent } = await import('../agent-service');
    return launchDocumentAgent(intentId, workspace, intent.folder);
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

  // ── Cloud agent launch ────────────────────────────────────
  ipcMain.handle('agent:launch-cloud', async (_event, intentId: string, prompt: string) => {
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
      intent_id: intentId || null,
      prompt,
      status: 'running',
      summary: `Cloud job ${result.jobId}`,
      working_dir: workspace,
      source: 'cloud' as any,
      persona_handle: null,
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
    const { getAgentHistory } = await import('../agent-service');
    return getAgentHistory(agentId);
  });

  ipcMain.handle('agent:get-working-dir', async (_event, agentId: string) => {
    const { getAgentSession } = await import('../database');
    const session = getAgentSession(agentId);
    return session?.working_dir ?? null;
  });
}
