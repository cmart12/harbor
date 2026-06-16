import { registerSpaceHandlers } from './space-handlers';
import { registerAgentHandlers } from './agent-handlers';
import { registerCanvasHandlers } from './canvas-handlers';
import { registerSettingsHandlers } from './settings-handlers';
import { registerChatHandlers } from './chat-handlers';
import { registerWorkspaceHandlers } from './workspace-handlers';
import { registerSkillHandlers } from './skill-handlers';
import { registerExportHandlers } from './export-handlers';
import { registerNotificationHandlers } from './notification-handlers';
import { registerGoalsHandlers } from './goals-handlers';
import { registerCategoriesHandlers } from './categories-handlers';
import { registerClassifierHandlers } from './classifier-handlers';
import { registerVipHandlers } from './vip-handlers';

export function registerIpcHandlers(): void {
  registerSpaceHandlers();
  registerAgentHandlers();
  registerCanvasHandlers();
  registerSettingsHandlers();
  registerChatHandlers();
  registerWorkspaceHandlers();
  registerSkillHandlers();
  registerExportHandlers();
  registerNotificationHandlers();
  registerGoalsHandlers();
  registerCategoriesHandlers();
  registerClassifierHandlers();
  registerVipHandlers();
}

// Re-export typed handler utilities
export { registerHandler, registerMessage, sendToAllWindows } from './typed-handler';

// Re-export validators (previously re-exported from ipc.ts)
export { validateMcpServers, validateCliTools } from '../validators';
