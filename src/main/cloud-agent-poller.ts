import { BrowserWindow } from 'electron';
import { getCloudJobStatus, CloudJobStatus } from './cloud-agent';
import { updateAgentSessionStatus } from './database';

interface PollState {
  agentId: string;
  owner: string;
  repo: string;
  jobId: string;
  token: string;
  intervalId: ReturnType<typeof setInterval>;
  lastStatus: CloudJobStatus | null;
}

const activePollers = new Map<string, PollState>();

function notifyAllWindows(channel: string, ...args: any[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

/**
 * Start polling a cloud job for status updates.
 * Polls every 10 seconds and emits agent status events.
 */
export function startCloudJobPoller(
  agentId: string,
  owner: string,
  repo: string,
  jobId: string,
  token: string,
): void {
  // Don't double-poll
  if (activePollers.has(agentId)) return;

  const state: PollState = {
    agentId,
    owner,
    repo,
    jobId,
    token,
    intervalId: null as any,
    lastStatus: null,
  };

  async function poll(): Promise<void> {
    const result = await getCloudJobStatus(state.owner, state.repo, state.jobId, state.token);
    if ('error' in result) {
      console.error(`[cloud-poller] Error polling job ${state.jobId}:`, result.error);
      return;
    }

    state.lastStatus = result;

    // Map cloud job status to agent status
    const prevStatus = state.lastStatus?.status;
    const cloudStatus = result.status;
    let agentStatus: string;
    let summary = result.result || result.problemStatement || '';

    if (cloudStatus === 'completed' || cloudStatus === 'succeeded') {
      agentStatus = 'completed';
      if (result.pullRequest?.url) {
        summary = `PR: ${result.pullRequest.url}`;
      }
    } else if (cloudStatus === 'failed' || cloudStatus === 'error' || cloudStatus === 'cancelled') {
      agentStatus = 'failed';
      summary = result.error?.message || `Job ${cloudStatus}`;
    } else {
      agentStatus = 'running';
    }

    // Update DB
    updateAgentSessionStatus(agentId, agentStatus, summary);

    // Notify renderer
    notifyAllWindows('agent:status-changed', { agentId, status: agentStatus, summary });

    // If terminal status, stop polling
    if (agentStatus === 'completed' || agentStatus === 'failed') {
      stopCloudJobPoller(agentId);
      notifyAllWindows('agent:completed', { agentId, status: agentStatus });
    }
  }

  // Initial poll immediately, then every 10s
  poll();
  state.intervalId = setInterval(poll, 10_000);
  activePollers.set(agentId, state);
}

export function stopCloudJobPoller(agentId: string): void {
  const state = activePollers.get(agentId);
  if (state) {
    clearInterval(state.intervalId);
    activePollers.delete(agentId);
  }
}

export function getCloudJobPollResult(agentId: string): CloudJobStatus | null {
  return activePollers.get(agentId)?.lastStatus ?? null;
}

export function stopAllCloudPollers(): void {
  for (const [id] of activePollers) {
    stopCloudJobPoller(id);
  }
}
