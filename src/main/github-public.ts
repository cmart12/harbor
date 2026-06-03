/**
 * GitHub API helpers that gracefully fall back when an org-SSO token is
 * unauthorized for an upstream repository.
 *
 * Motivation: when the user's only stored GitHub token is scoped to one org
 * (e.g. their employer) and they ask the agent to operate on a *public*
 * upstream repo (e.g. `github/copilot-sdk`), the API rejects requests with
 * 401/403 + `X-GitHub-SSO` header. Today that bubbles up as a fatal
 * "Authorize the token via the URL above" prompt. For public repos we don't
 * need that token at all:
 *
 *   1. Reads work without any auth (60 req/hr/IP — plenty for triage).
 *   2. Writes work via fork → branch → PR using the user's own namespace,
 *      so the upstream org's SSO never enters the picture.
 *
 * This module provides the building blocks. `cloud-agent.ts` composes them
 * into a fallback chain.
 */
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const GITHUB_API_BASE = 'https://api.github.com';

export interface RepoMetadata {
  owner: string;
  repo: string;
  isPrivate: boolean;
  defaultBranch: string;
  fork: boolean;
  parent?: { owner: string; repo: string };
}

export interface ForkResult {
  owner: string;
  repo: string;
  htmlUrl: string;
  cloneUrl: string;
  /** True if the API reported the fork was already present. */
  preExisting: boolean;
}

export interface SSOErrorInfo {
  /** Resource URL that triggered the SSO prompt, if the API returned one. */
  authorizeUrl?: string;
  /** Raw `X-GitHub-SSO` header value. */
  ssoHeader: string;
  status: number;
}

/**
 * Returns `null` if the response is not an SSO-gated 401/403, otherwise
 * parsed details. The header looks like:
 *   X-GitHub-SSO: required; url=https://github.com/orgs/<org>/sso?...
 * or for resources not authorized for SSO:
 *   X-GitHub-SSO: partial-results; organizations=...
 */
export function detectSSOError(response: { status: number; headers: Headers }): SSOErrorInfo | null {
  if (response.status !== 401 && response.status !== 403) return null;
  const header = response.headers.get('x-github-sso');
  if (!header) return null;
  let authorizeUrl: string | undefined;
  const urlMatch = header.match(/url=([^;,\s]+)/i);
  if (urlMatch) authorizeUrl = urlMatch[1];
  return { ssoHeader: header, status: response.status, ...(authorizeUrl ? { authorizeUrl } : {}) };
}

function buildHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'whim-app',
  };
  if (token) headers['Authorization'] = `token ${token}`;
  return headers;
}

/**
 * Fetch repo metadata. Tries unauthenticated first because public repos
 * don't need a token and an org-SSO-scoped token would 403. Falls back to
 * the authenticated request only if the unauth call hits 404 (which could
 * mean the repo is private and we need auth to see it at all).
 */
export async function fetchRepoMetadata(
  owner: string,
  repo: string,
  token?: string | null,
): Promise<RepoMetadata | { error: string; sso?: SSOErrorInfo }> {
  const url = `${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

  // Step 1: try with no auth — works for all public repos, never triggers SSO.
  let response: Response;
  try {
    response = await fetch(url, { headers: buildHeaders(null) });
  } catch (err: any) {
    return { error: `Network error fetching repo metadata: ${err?.message ?? err}` };
  }

  if (response.ok) return parseRepoMetadata(await response.json());

  // 404 with no auth could mean (a) the repo doesn't exist, or (b) it's
  // private and we need auth. Retry with the token if we have one.
  if (response.status === 404 && token) {
    try {
      response = await fetch(url, { headers: buildHeaders(token) });
    } catch (err: any) {
      return { error: `Network error fetching repo metadata (authed): ${err?.message ?? err}` };
    }
    if (response.ok) return parseRepoMetadata(await response.json());
    const sso = detectSSOError(response);
    if (sso) return { error: `SSO authorization required (${response.status})`, sso };
    return { error: `Repo not accessible: ${response.status}` };
  }

  // 401/403 from an unauthenticated call against api.github.com would be
  // unusual (we sent no token), but if seen pass it through.
  return { error: `Repo metadata fetch failed: ${response.status}` };
}

function parseRepoMetadata(data: any): RepoMetadata {
  const parent = data.parent
    ? { owner: data.parent.owner?.login, repo: data.parent.name }
    : undefined;
  return {
    owner: data.owner?.login,
    repo: data.name,
    isPrivate: Boolean(data.private),
    defaultBranch: data.default_branch || 'main',
    fork: Boolean(data.fork),
    ...(parent && parent.owner && parent.repo ? { parent: parent as { owner: string; repo: string } } : {}),
  };
}

/**
 * Convenience wrapper: returns true if the repo is public (visible to the
 * unauthenticated API). Returns null on errors so callers can distinguish
 * "definitely public", "definitely private", and "couldn't tell".
 */
export async function isRepoPublic(
  owner: string,
  repo: string,
): Promise<boolean | null> {
  const meta = await fetchRepoMetadata(owner, repo);
  if ('error' in meta) return null;
  return !meta.isPrivate;
}

/**
 * Resolve the authenticated user's login for the supplied token. Used to
 * predict the fork owner (forks always land under the authenticated user
 * unless an org is specified, which we don't).
 */
export async function getAuthenticatedLogin(token: string): Promise<string | { error: string; sso?: SSOErrorInfo }> {
  try {
    const response = await fetch(`${GITHUB_API_BASE}/user`, { headers: buildHeaders(token) });
    if (response.ok) {
      const data = (await response.json()) as { login?: string };
      if (data.login) return data.login;
      return { error: 'User payload missing login' };
    }
    const sso = detectSSOError(response);
    if (sso) return { error: `SSO authorization required for /user (${response.status})`, sso };
    return { error: `Failed to resolve authenticated user: ${response.status}` };
  } catch (err: any) {
    return { error: `Network error resolving authenticated user: ${err?.message ?? err}` };
  }
}

/**
 * Fork a repo into the authenticated user's namespace. The GitHub fork
 * endpoint is asynchronous — it returns 202 immediately and the fork may
 * take a few seconds to become usable. We poll with backoff until the fork
 * repo responds to a metadata fetch (or we time out).
 */
export async function forkRepo(
  owner: string,
  repo: string,
  token: string,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<ForkResult | { error: string; sso?: SSOErrorInfo }> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 1_500;

  let response: Response;
  try {
    response = await fetch(`${GITHUB_API_BASE}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/forks`, {
      method: 'POST',
      headers: { ...buildHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  } catch (err: any) {
    return { error: `Network error creating fork: ${err?.message ?? err}` };
  }

  // 202 Accepted (fork being created) and 200/201 (fork already exists or
  // created synchronously) all carry a JSON body with the fork details.
  if (response.status !== 200 && response.status !== 201 && response.status !== 202) {
    const sso = detectSSOError(response);
    const text = await response.text().catch(() => '');
    if (sso) return { error: `SSO authorization required to fork (${response.status})`, sso };
    return { error: `Fork creation failed: ${response.status} ${text.slice(0, 200)}` };
  }

  let data: any;
  try {
    data = await response.json();
  } catch (err: any) {
    return { error: `Invalid fork response body: ${err?.message ?? err}` };
  }

  const forkOwner: string | undefined = data?.owner?.login;
  const forkRepoName: string | undefined = data?.name;
  if (!forkOwner || !forkRepoName) {
    return { error: 'Fork response missing owner/name' };
  }

  // For 202 Accepted, poll until the fork is reachable. For 200/201 it's
  // already ready but the poll is harmless and short-circuits on first hit.
  const deadline = Date.now() + timeoutMs;
  let preExisting = response.status === 200; // 200 = fork already existed
  let ready = response.status !== 202;
  while (!ready && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    const check = await fetchRepoMetadata(forkOwner, forkRepoName, token);
    if (!('error' in check)) {
      ready = true;
      break;
    }
  }
  if (!ready) {
    return { error: `Fork ${forkOwner}/${forkRepoName} not ready after ${timeoutMs}ms` };
  }

  return {
    owner: forkOwner,
    repo: forkRepoName,
    htmlUrl: data.html_url || `https://github.com/${forkOwner}/${forkRepoName}`,
    cloneUrl: data.clone_url || `https://github.com/${forkOwner}/${forkRepoName}.git`,
    preExisting,
  };
}

export interface PreparedForkContext {
  /** Owner the fork lives under (= authenticated user). */
  owner: string;
  /** Repo name on the fork (typically same as upstream). */
  repo: string;
  htmlUrl: string;
  /** Upstream the fork was made from. */
  upstream: { owner: string; repo: string };
  /** True when this run created the fork; false when it already existed. */
  created: boolean;
}

/**
 * High-level helper: ensure a fork of `upstreamOwner/upstreamRepo` exists
 * under the authenticated user, returning the fork's coordinates. If a
 * suitable fork already exists, we reuse it (no second fork call required).
 */
export async function prepareForkedWriteContext(
  upstreamOwner: string,
  upstreamRepo: string,
  token: string,
): Promise<PreparedForkContext | { error: string; sso?: SSOErrorInfo }> {
  const loginResult = await getAuthenticatedLogin(token);
  if (typeof loginResult !== 'string') return loginResult;
  const login = loginResult;

  // First, see if the user already has a fork with the same repo name.
  const existing = await fetchRepoMetadata(login, upstreamRepo, token);
  if (!('error' in existing) && existing.fork && existing.parent
      && existing.parent.owner.toLowerCase() === upstreamOwner.toLowerCase()
      && existing.parent.repo.toLowerCase() === upstreamRepo.toLowerCase()) {
    return {
      owner: login,
      repo: existing.repo,
      htmlUrl: `https://github.com/${login}/${existing.repo}`,
      upstream: { owner: upstreamOwner, repo: upstreamRepo },
      created: false,
    };
  }

  const fork = await forkRepo(upstreamOwner, upstreamRepo, token);
  if ('error' in fork) return fork;
  return {
    owner: fork.owner,
    repo: fork.repo,
    htmlUrl: fork.htmlUrl,
    upstream: { owner: upstreamOwner, repo: upstreamRepo },
    created: !fork.preExisting,
  };
}

/**
 * Shell out to `git clone` against the unauthenticated public URL — never
 * embeds a token, so SSO walls don't apply. Returns the destination path on
 * success.
 */
export async function cloneRepoUnauth(
  owner: string,
  repo: string,
  destPath: string,
  options: { branch?: string; depth?: number } = {},
): Promise<{ path: string } | { error: string }> {
  const args = ['clone'];
  if (options.depth) args.push(`--depth=${options.depth}`);
  if (options.branch) args.push(`--branch=${options.branch}`);
  args.push(`https://github.com/${owner}/${repo}.git`);
  args.push(destPath);
  try {
    await execAsync(`git ${args.map(a => `"${a}"`).join(' ')}`);
    return { path: destPath };
  } catch (err: any) {
    return { error: `git clone failed: ${err?.message ?? err}` };
  }
}
