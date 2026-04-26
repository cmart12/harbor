import { ipcMain } from 'electron';

export function registerChatHandlers(): void {
  ipcMain.handle('chat:send-message', async (_event, agentId: string, prompt: string, attachments?: Array<{ type: 'file'; path: string }>) => {
    const { sendChatMessage } = await import('../agent-service');
    return sendChatMessage(agentId, prompt, attachments);
  });

  ipcMain.handle('chat:set-model', async (_event, agentId: string, model: string) => {
    const { setAgentModel } = await import('../agent-service');
    return setAgentModel(agentId, model);
  });

  // ── Sub-agent tracking ─────────────────────────────────
  ipcMain.handle('subagent:list', async (_event, parentAgentId: string) => {
    const { subagentTracker } = await import('../agent-service');
    return subagentTracker.listSubagents(parentAgentId);
  });

  ipcMain.handle('subagent:read', async (_event, parentAgentId: string, agentId: string) => {
    const { subagentTracker } = await import('../agent-service');
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
