import type { Tool } from '@github/copilot-sdk';
import type { InteractionBroker } from '../agents/interaction-broker';
import { createAskUserTool } from './ask-user';
import { webFetchTool } from './web-fetch';

/** Returns all custom tools to register with SDK sessions. */
export function getCustomTools(context?: { agentId: string; broker: InteractionBroker }): Tool<any>[] {
  const tools: Tool<any>[] = [webFetchTool];
  if (context) {
    tools.push(createAskUserTool(context.agentId, context.broker));
  }
  return tools;
}
