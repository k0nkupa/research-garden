/**
 * Pure decision logic for the offline application shell (ticket 16, ADR 0072).
 *
 * Kept free of `self`/`caches`/`fetch` so it can be unit tested directly,
 * without a service worker runtime. `serviceWorker.ts` is the thin, largely
 * untestable glue that calls these functions; verifying *that* file's actual
 * install/activate/fetch behaviour is done with a real browser (see the
 * ticket's Notes), not here.
 */

/** Every cache this application ever creates for the shell shares this prefix. */
export const SHELL_CACHE_PREFIX = 'research-garden-shell-'

/** The one cache name for a given build version. */
export function shellCacheName(version: string): string {
  return `${SHELL_CACHE_PREFIX}${version}`
}

/**
 * Which of the Cache Storage keys belong to this app's shell but are not the
 * current version — the classic "new version supersedes the cached shell"
 * cleanup list. Caches this app never created (or a future app might) are
 * left alone by construction: only names sharing the prefix are candidates.
 */
export function staleCacheNames(
  existingCacheNames: readonly string[],
  currentCacheName: string,
): string[] {
  return existingCacheNames.filter(
    (name) => name.startsWith(SHELL_CACHE_PREFIX) && name !== currentCacheName,
  )
}

/**
 * How (or whether) a request may be served from the shell cache. This is the
 * complete, closed allowlist of what the service worker may ever cache: the
 * versioned application shell (built HTML/JS/CSS under Vite's `/assets/`
 * output, the document itself, and the installability assets) and nothing
 * else. Everything else resolves to `null`, meaning "the fetch handler must
 * not intercept this at all" — not "deny and respond with an error".
 *
 * This is an allowlist rather than a denylist naming Garden files or tool
 * results, because there is nothing to deny: neither ever travels as a
 * `fetch` request in the first place (File System Access reads use the
 * browser's local handle APIs directly; a WebMCP tool call returns its result
 * directly to the caller, never over HTTP). The fetch event this function
 * guards simply never fires for them. An allowlist keeps that true even as
 * the application grows — a new remote endpoint added later is excluded by
 * default, not admitted until someone remembers to deny it.
 *
 * The strategy choice is part of the same decision, not a second `if` beside
 * it: the document shell (`/`, `/index.html`) prefers the network so an
 * online visit is never held back by a stale cached HTML file referencing a
 * superseded build's assets, while Vite's content-hashed build output is
 * immutable once emitted, so cache-first is exactly right for it, not merely
 * faster. Both the fetch handler and the install-time precache step (which
 * writes to the very same cache) route every URL through this one function,
 * so there is exactly one place that decides what is cacheable at all.
 */
export type ShellCacheStrategy = 'network-first' | 'cache-first'

export function shellCacheStrategyFor(url: URL, origin: string): ShellCacheStrategy | null {
  if (url.origin !== origin) return null
  if (url.pathname === '/sw.js') return null

  if (url.pathname === '/' || url.pathname === '/index.html') return 'network-first'
  if (url.pathname === '/manifest.webmanifest') return 'cache-first'
  if (url.pathname.startsWith('/assets/')) return 'cache-first'
  if (/^\/icon[-.]/.test(url.pathname)) return 'cache-first'

  return null
}
