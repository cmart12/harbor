import type { Tool } from '@github/copilot-sdk';
import { webFetchTool } from './web-fetch';

/** Returns all custom tools to register with SDK sessions. */
export function getCustomTools(): Tool<any>[] {
  return [webFetchTool];
}
