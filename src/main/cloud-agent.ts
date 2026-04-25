import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface CloudJobResult {
  jobId: string;
  sessionId: string;
  actor: { id: string; login: string };
  createdAt: string;
  updatedAt: string;
}

export interface CloudJobStatus {
  jobId: string;
  sessionId: string;
  problemStatement: string;
  status: string;
  result?: string;
  actor: { id: string; login: string };
  createdAt: string;
  updatedAt: string;
  pullRequest?: { id: string; number: number; url?: string };
  workflowRun?: { id: string };
  error?: { message: string };
}

/**
 * Parse git remote origin URL to extract owner/repo.
 * Supports HTTPS and SSH formats:
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 */
export function parseGitRemote(remoteUrl: string): { owner: string; repo: string } | null {
  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };

  // SSH: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };

  return null;
}

/**
 * Get the owner/repo for the workspace by reading git remote origin.
 */
export async function getWorkspaceRepo(workspacePath: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await execAsync('git remote get-url origin', { cwd: workspacePath });
    return parseGitRemote(stdout.trim());
  } catch {
    return null;
  }
}

/**
 * Get a GitHub token. Tries `gh auth token` first, then env vars.
 */
export async function getGitHubToken(): Promise<string | null> {
  // Try environment variables first
  for (const envVar of ['GITHUB_TOKEN', 'GH_TOKEN', 'COPILOT_GITHUB_TOKEN']) {
    if (process.env[envVar]) return process.env[envVar]!;
  }

  // Try gh CLI
  try {
    const { stdout } = await execAsync('gh auth token');
    const token = stdout.trim();
    if (token) return token;
  } catch { /* gh not available */ }

  return null;
}

/**
 * Get the Copilot API base URL. Uses environment variable or fetches from
 * the GitHub Copilot API endpoint.
 */
async function getCopilotApiBaseUrl(token: string): Promise<string> {
  if (process.env.COPILOT_API_URL) return process.env.COPILOT_API_URL;

  // Fetch the Copilot user endpoint to discover the API URL
  try {
    const resp = await fetch('https://api.github.com/copilot_internal/v2/token', {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/json',
      },
    });
    if (resp.ok) {
      const data = await resp.json() as { endpoints?: { api?: string } };
      if (data.endpoints?.api) return data.endpoints.api;
    }
  } catch { /* fallback below */ }

  // Fallback: standard Copilot API URL
  return 'https://api.githubcopilot.com';
}

/**
 * Launch a cloud agent job via the Copilot SWE API.
 */
export async function launchCloudAgent(
  owner: string,
  repo: string,
  prompt: string,
  token: string,
): Promise<CloudJobResult | { error: string }> {
  try {
    const baseUrl = await getCopilotApiBaseUrl(token);
    const url = `${baseUrl}/agents/swe/v1/jobs/${owner}/${repo}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        problem_statement: prompt,
        pull_request: {
          body_suffix: 'Created from Intent app.',
        },
        event_type: 'intent_app',
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[cloud-agent] Job creation failed (${response.status}): ${text}`);
      return { error: `Cloud agent launch failed: ${response.status} ${response.statusText}` };
    }

    const data = await response.json() as {
      job_id: string;
      session_id: string;
      actor: { id: string; login: string };
      created_at: string;
      updated_at: string;
    };

    return {
      jobId: data.job_id,
      sessionId: data.session_id,
      actor: data.actor,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  } catch (err: any) {
    console.error('[cloud-agent] Launch error:', err);
    return { error: err.message || 'Failed to launch cloud agent' };
  }
}

/**
 * Poll cloud agent job status.
 */
export async function getCloudJobStatus(
  owner: string,
  repo: string,
  jobId: string,
  token: string,
): Promise<CloudJobStatus | { error: string }> {
  try {
    const baseUrl = await getCopilotApiBaseUrl(token);
    const url = `${baseUrl}/agents/swe/v1/jobs/${owner}/${repo}/${jobId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return { error: `Status check failed: ${response.status}` };
    }

    const data = await response.json() as {
      job_id: string;
      session_id: string;
      problem_statement: string;
      status: string;
      result?: string;
      actor: { id: string; login: string };
      created_at: string;
      updated_at: string;
      pull_request?: { id: string; number: number };
      workflow_run?: { id: string };
      error?: { message: string };
    };

    let prUrl: string | undefined;
    if (data.pull_request?.number) {
      prUrl = `https://github.com/${owner}/${repo}/pull/${data.pull_request.number}`;
    }

    return {
      jobId: data.job_id,
      sessionId: data.session_id,
      problemStatement: data.problem_statement,
      status: data.status,
      result: data.result,
      actor: data.actor,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      pullRequest: data.pull_request ? { ...data.pull_request, url: prUrl } : undefined,
      workflowRun: data.workflow_run,
      error: data.error,
    };
  } catch (err: any) {
    return { error: err.message || 'Failed to check cloud job status' };
  }
}
