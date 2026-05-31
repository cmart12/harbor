/**
 * Renderer theme engine.
 *
 * Owns the single source of truth for how a theme *choice* (`light` / `dark` /
 * `system`) is resolved to a concrete appearance and applied to the document.
 * All renderer window modes (main, canvas popout, settings popout) go through
 * here so theme handling lives in one place rather than being smeared across
 * `app.ts`.
 *
 * Appearance is expressed as the `dark` class on `<body>`; `styles.css` defines
 * the light token set on `:root` and overrides it under `body.dark`.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const DARK_QUERY = '(prefers-color-scheme: dark)';

let currentChoice: ThemeChoice = 'system';
let mediaQuery: MediaQueryList | null = null;
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

/** Coerce an untrusted value (e.g. from settings storage or IPC) to a valid choice. */
export function normalizeChoice(value: unknown): ThemeChoice {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

/** Resolve a choice to a concrete appearance, consulting the OS for `system`. */
export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') {
    return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
  }
  return choice;
}

/** The appearance currently painted on the document (`light` unless `body.dark`). */
export function getResolvedTheme(): ResolvedTheme {
  return document.body.classList.contains('dark') ? 'dark' : 'light';
}

function paint(resolved: ResolvedTheme): void {
  document.body.classList.toggle('dark', resolved === 'dark');
}

/**
 * Subscribe to OS appearance changes only while the active choice is `system`;
 * tear the subscription down for explicit `light` / `dark` choices.
 */
function syncSystemListener(): void {
  if (currentChoice === 'system') {
    if (!mediaQuery) {
      mediaQuery = window.matchMedia(DARK_QUERY);
      mediaListener = () => {
        if (currentChoice === 'system') paint(resolveTheme('system'));
      };
      mediaQuery.addEventListener('change', mediaListener);
    }
  } else if (mediaQuery && mediaListener) {
    mediaQuery.removeEventListener('change', mediaListener);
    mediaQuery = null;
    mediaListener = null;
  }
}

/**
 * Apply a theme choice: resolve it, paint the body class, and (re)subscribe to
 * OS appearance changes when — and only when — the choice is `system`.
 */
export function applyTheme(choice: ThemeChoice): void {
  currentChoice = choice;
  paint(resolveTheme(choice));
  syncSystemListener();
}
