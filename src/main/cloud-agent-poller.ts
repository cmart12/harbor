import { BrowserWindow } from 'electron';
import { getCloudJobStatus, CloudJobStatus } from './cloud-agent';
import { updateAgentSessionStatus } from './database';
import { mirrorRendererEvent } from './web/event-hub';

interface PollState {
  agentId: string;
  owner: string;
  repo: string;
  jobId: string;
  token: string;
  intervalId: ReturnType<typeof setInterval>;
  lastStatus: CloudJobStatus | null;
  url: string;
}

const activePollers = new Map<string, PollState>();

function notifyAllWindows(channel: string, ...args: any[]): void {
  mirrorRendererEvent(channel, ...args);
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
    url: `https://github.com/${owner}/${repo}`,
  };

  async function poll(): Promise<void> {
    const result = await getCloudJobStatus(state.owner, state.repo, state.jobId, state.token);
    if (typeof (result as any).error === 'string') {
      console.error(`[cloud-poller] Error polling job ${state.jobId}:`, (result as { error: string }).error);
      return;
    }

    state.lastStatus = result as CloudJobStatus;

    // Update URL — prefer PR URL when available
    const prUrl = (result as CloudJobStatus).pullRequest?.url;
    if (prUrl) {
      state.url = prUrl;
    }

    // Map cloud job status to agent status
    const status = result as CloudJobStatus;
    const cloudStatus = status.status;
    let agentStatus: string;
    let summary = status.result || status.problemStatement || '';

    if (cloudStatus === 'completed' || cloudStatus === 'succeeded') {
      agentStatus = 'completed';
      if (status.pullRequest?.url) {
        summary = `PR: ${status.pullRequest.url}`;
      }
    } else if (cloudStatus === 'failed' || cloudStatus === 'error' || cloudStatus === 'cancelled') {
      agentStatus = 'failed';
      summary = status.error?.message || `Job ${cloudStatus}`;
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

export function getCloudJobPollResult(agentId: string): (CloudJobStatus & { url?: string }) | null {
  const state = activePollers.get(agentId);
  if (!state) return null;
  return state.lastStatus ? { ...state.lastStatus, url: state.url } : null;
}

export function stopAllCloudPollers(): void {
  for (const [id] of activePollers) {
    stopCloudJobPoller(id);
  }
}
