import { exec } from 'child_process';
import { promisify } from 'util';
import {
  detectSSOError,
  fetchRepoMetadata,
  prepareForkedWriteContext,
  type SSOErrorInfo,
} from './github-public';

const execAsync = promisify(exec);

export interface CloudJobResult {
  jobId: string;
  sessionId: string;
  actor: { id: string; login: string };
  createdAt: string;
  updatedAt: string;
}

export interface CloudJobFallbackInfo {
  /** Owner/repo the job was actually launched against (= fork). */
  effectiveOwner: string;
  effectiveRepo: string;
  /** Upstream the user originally pointed at. */
  upstream: { owner: string; repo: string };
  /** Fork's HTML URL — useful for surfacing in the UI. */
  forkUrl: string;
  /** True when this run created the fork; false when it already existed. */
  forkCreated: boolean;
  reason: 'sso_blocked' | 'pre_authorized_public';
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
          body_suffix: 'Created from Whim app.',
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
 * Internal: low-level launch that returns the raw HTTP response so callers
 * can inspect status/headers and decide whether to fall back. Mirrors
 * launchCloudAgent but does not swallow the response on failure.
 */
async function launchCloudAgentRaw(
  owner: string,
  repo: string,
  prompt: string,
  token: string,
): Promise<{ ok: true; result: CloudJobResult } | { ok: false; response: Response; bodyText: string }> {
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
      pull_request: { body_suffix: 'Created from Whim app.' },
      event_type: 'intent_app',
    }),
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    return { ok: false, response, bodyText };
  }
  const data = (await response.json()) as {
    job_id: string;
    session_id: string;
    actor: { id: string; login: string };
    created_at: string;
    updated_at: string;
  };
  return {
    ok: true,
    result: {
      jobId: data.job_id,
      sessionId: data.session_id,
      actor: data.actor,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    },
  };
}

export interface LaunchCloudAgentWithFallbackOptions {
  /**
   * If true (the default), when the upstream POST fails with an SSO-gated
   * 401/403 AND the upstream repo is public, automatically fork into the
   * user's namespace and retry against the fork. Set false to disable
   * fallback (e.g. when the caller specifically wants to push to upstream).
   */
  enableForkFallback?: boolean;
}

export interface LaunchCloudAgentWithFallbackResult {
  result: CloudJobResult;
  fallback?: CloudJobFallbackInfo;
}

/**
 * Launch a cloud agent against `owner/repo`, falling back to a fork in the
 * user's namespace when the upstream is SSO-gated and public. This makes
 * "review and modify public repos" work without forcing the user through
 * an org SSO authorization prompt for a token they never needed in the
 * first place.
 *
 * Returns the underlying CloudJobResult plus an optional `fallback` block
 * the UI can use to explain "we launched on your fork at <forkUrl>".
 */
export async function launchCloudAgentWithFallback(
  owner: string,
  repo: string,
  prompt: string,
  token: string,
  options: LaunchCloudAgentWithFallbackOptions = {},
): Promise<LaunchCloudAgentWithFallbackResult | { error: string; sso?: SSOErrorInfo; suggestion?: string }> {
  const enableForkFallback = options.enableForkFallback ?? true;

  let attempt: Awaited<ReturnType<typeof launchCloudAgentRaw>>;
  try {
    attempt = await launchCloudAgentRaw(owner, repo, prompt, token);
  } catch (err: any) {
    console.error('[cloud-agent] Launch error:', err);
    return { error: err?.message || 'Failed to launch cloud agent' };
  }

  if (attempt.ok) {
    return { result: attempt.result };
  }

  // Non-OK upstream response. Decide whether to fall back.
  const sso = detectSSOError(attempt.response);
  if (!sso || !enableForkFallback) {
    console.error(`[cloud-agent] Job creation failed (${attempt.response.status}): ${attempt.bodyText}`);
    return {
      error: `Cloud agent launch failed: ${attempt.response.status} ${attempt.response.statusText}`,
      ...(sso ? { sso } : {}),
    };
  }

  // SSO-gated. Check if the upstream is public — if so we can fork.
  const meta = await fetchRepoMetadata(owner, repo, null);
  if ('error' in meta) {
    return {
      error: `Cloud agent launch blocked by org SSO and could not verify upstream visibility: ${meta.error}`,
      sso,
      suggestion: sso.authorizeUrl
        ? `Authorize the token at ${sso.authorizeUrl} or use a personal token without org SSO restrictions.`
        : 'Use a personal token without org SSO restrictions for this repository.',
    };
  }
  if (meta.isPrivate) {
    return {
      error: `Cloud agent launch blocked: ${owner}/${repo} is private and your token is not authorized for the org's SSO.`,
      sso,
      suggestion: sso.authorizeUrl
        ? `Authorize the token at ${sso.authorizeUrl} so it can access ${owner}/${repo}.`
        : 'Authorize the token for the upstream org or supply a token with access.',
    };
  }

  // Public + SSO-gated → fork and retry.
  console.warn(`[cloud-agent] Upstream ${owner}/${repo} returned SSO ${attempt.response.status}; falling back to a fork.`);
  const fork = await prepareForkedWriteContext(owner, repo, token);
  if ('error' in fork) {
    return {
      error: `Cloud agent launch blocked by SSO and fork fallback failed: ${fork.error}`,
      sso,
      ...(fork.sso ? { sso: fork.sso } : {}),
    };
  }

  let forkAttempt: Awaited<ReturnType<typeof launchCloudAgentRaw>>;
  try {
    forkAttempt = await launchCloudAgentRaw(fork.owner, fork.repo, prompt, token);
  } catch (err: any) {
    return { error: `Cloud agent launch on fork failed: ${err?.message ?? err}` };
  }
  if (!forkAttempt.ok) {
    console.error(`[cloud-agent] Fork-fallback job creation failed (${forkAttempt.response.status}): ${forkAttempt.bodyText}`);
    return {
      error: `Cloud agent launch on fork ${fork.owner}/${fork.repo} failed: ${forkAttempt.response.status} ${forkAttempt.response.statusText}`,
    };
  }

  const fallback: CloudJobFallbackInfo = {
    effectiveOwner: fork.owner,
    effectiveRepo: fork.repo,
    upstream: fork.upstream,
    forkUrl: fork.htmlUrl,
    forkCreated: fork.created,
    reason: 'sso_blocked',
  };
  return { result: forkAttempt.result, fallback };
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
      ...(data.error ? { error: data.error } : {}),
    };
  } catch (err: any) {
    return { error: err.message || 'Failed to check cloud job status' };
  }
}
