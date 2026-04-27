/**
 * Deterministic emoji picker for skills.
 * Matches keywords in the skill name/description to a curated emoji,
 * falling back to a hash-based selection from a diverse palette.
 */

const KEYWORD_MAP: [string[], string][] = [
  [['pdf', 'document', 'doc', 'word', 'docx'], '📄'],
  [['spreadsheet', 'excel', 'xlsx', 'csv', 'tsv'], '📊'],
  [['presentation', 'slides', 'pptx', 'deck', 'powerpoint'], '📽️'],
  [['email', 'mail', 'inbox', 'outlook', 'gmail'], '📧'],
  [['code', 'programming', 'coding', 'refactor'], '💻'],
  [['test', 'testing', 'qa', 'quality'], '🧪'],
  [['deploy', 'deployment', 'release', 'ship', 'ci/cd', 'pipeline'], '🚀'],
  [['review', 'pr', 'pull request', 'code review'], '👀'],
  [['bug', 'debug', 'fix', 'issue', 'triage'], '🐛'],
  [['design', 'ui', 'ux', 'figma', 'layout', 'style'], '🎨'],
  [['database', 'sql', 'query', 'schema', 'migration'], '🗃️'],
  [['api', 'rest', 'graphql', 'endpoint', 'webhook'], '🔌'],
  [['security', 'auth', 'encrypt', 'password', 'token', 'oauth'], '🔒'],
  [['search', 'find', 'lookup', 'index'], '🔍'],
  [['write', 'writing', 'content', 'blog', 'article', 'copy'], '✍️'],
  [['chat', 'conversation', 'message', 'slack', 'teams'], '💬'],
  [['image', 'photo', 'picture', 'screenshot', 'graphic'], '🖼️'],
  [['video', 'movie', 'recording', 'screen'], '🎬'],
  [['music', 'audio', 'sound', 'podcast'], '🎵'],
  [['money', 'finance', 'payment', 'expense', 'invoice', 'billing', 'budget'], '💰'],
  [['calendar', 'schedule', 'meeting', 'event', 'booking'], '📅'],
  [['note', 'notes', 'memo', 'journal'], '📝'],
  [['report', 'analytics', 'metrics', 'dashboard', 'stats'], '📈'],
  [['translate', 'translation', 'language', 'i18n', 'localization'], '🌐'],
  [['clean', 'cleanup', 'lint', 'format', 'prettier'], '🧹'],
  [['automate', 'automation', 'workflow', 'bot'], '🤖'],
  [['learn', 'tutorial', 'guide', 'onboard', 'documentation'], '📚'],
  [['monitor', 'alert', 'log', 'observability', 'health'], '📡'],
  [['migrate', 'transfer', 'import', 'export', 'sync'], '🔄'],
  [['plan', 'planning', 'roadmap', 'strategy', 'backlog'], '🗺️'],
  [['generate', 'scaffold', 'template', 'boilerplate', 'create'], '⚡'],
  [['git', 'commit', 'branch', 'merge', 'rebase'], '🌿'],
  [['docker', 'container', 'kubernetes', 'k8s', 'infra'], '🐳'],
  [['notification', 'notify', 'remind', 'reminder'], '🔔'],
  [['diagram', 'chart', 'graph', 'visualize', 'draw'], '📐'],
];

/** Diverse emoji palette for hash-based fallback. */
const FALLBACK_PALETTE = [
  '⚡', '🎯', '🔮', '🧊', '🌟', '🎲', '🧭', '🔧',
  '🪄', '🏷️', '📌', '🎪', '🧬', '🌀', '💎', '🪁',
  '🔑', '🛠️', '📦', '🎛️', '🏗️', '🧲', '⚙️', '🪩',
];

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Pick a descriptive emoji for a skill based on its name and description.
 * Scans for keyword matches first, then falls back to a deterministic
 * hash-based selection from a diverse palette.
 */
export function pickEmoji(name: string, description: string): string {
  const text = `${name} ${description}`.toLowerCase();

  for (const [keywords, emoji] of KEYWORD_MAP) {
    for (const kw of keywords) {
      // Match as a whole word (bounded by non-alpha chars or string edges)
      const pattern = new RegExp(`(?:^|[^a-z])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^a-z]|$)`);
      if (pattern.test(text)) {
        return emoji;
      }
    }
  }

  return FALLBACK_PALETTE[simpleHash(name) % FALLBACK_PALETTE.length];
}
