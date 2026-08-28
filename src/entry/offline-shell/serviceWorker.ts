// @ts-nocheck
//
// This file runs in a ServiceWorkerGlobalScope, not a Window: `self`,
// `caches`, `clients`, and the install/activate/fetch events it uses are
// typed by TypeScript's "webworker" lib, which cannot coexist in the same
// program as the "dom" lib the rest of this app is checked against (both
// declare incompatible globals named `self`). Splitting this one file into a
// second tsconfig project would buy back type-checking here at the cost of a
// second build-time project to keep in sync, for a file that is intentionally
// this thin: every real decision it makes is delegated to the fully
// type-checked, fully unit-tested functions in `serviceWorkerCache.ts` below,
// including *which* strategy applies to a URL — this file only ever asks that
// module, never re-derives the answer itself. What remains here —
// install/activate/fetch wiring — is exactly what this ticket's own process
// calls "harder to unit test" and verifies with a real browser instead (see
// the ticket's Notes for how).
//
// ADR 0072: cache the application shell, not the Garden. Garden files and
// WebMCP tool results are never reachable from here: they never travel as
// `fetch` requests (File System Access reads use the browser's local handle
// APIs directly; a WebMCP tool call returns its result directly to the
// caller, never over HTTP), so this file's fetch handler never even sees
// them, let alone caches them. `shellCacheStrategyFor`'s allowlist is the
// enforceable form of that argument — and both places that write to the
// cache (the fetch handler below and the install-time precache step) go
// through it, not just one of the two.

import { shellCacheName, shellCacheStrategyFor, staleCacheNames } from './serviceWorkerCache'

// Replaced at build time (see vite.config.ts) with a value that changes on
// every production build, so the browser's own byte-comparison update check
// reliably notices a new service worker and runs the update lifecycle below.
declare const __SW_VERSION__: string

const CACHE_NAME = shellCacheName(__SW_VERSION__)

self.addEventListener('install', (event) => {
  // Do not wait for every open tab of the previous version to close before
  // taking over: skipWaiting + clients.claim (below) is what makes a new
  // application version supersede the cached shell rather than being
  // shadowed by it.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)

      // Precache this exact build's versioned shell files by name (see
      // vite.config.ts's precacheManifestPlugin). This is what makes the
      // shell work offline after only one visit: the page that triggers this
      // install is not yet controlled by this service worker, so its own
      // requests for the JS/CSS bundle never reach the fetch handler below —
      // without an explicit precache list, only whatever this install step
      // fetches directly would ever get cached.
      const manifest: string[] = await fetch('/precache-manifest.json')
        .then((response) => response.json())
        .catch(() => ['/'])

      // The manifest is build-generated and already trustworthy, but every
      // entry is still routed through shellCacheStrategyFor rather than
      // cached unconditionally — the allowlist governs *every* write to this
      // cache, not only the ones that arrive through the fetch handler.
      const precacheable = manifest.filter(
        (url) => shellCacheStrategyFor(new URL(url, self.location.origin), self.location.origin) !== null,
      )

      // Each entry is cached independently rather than via cache.addAll,
      // which aborts the whole precache (and so the whole install) if a
      // single asset fails. One flaky asset must not cost the entire offline
      // shell.
      await Promise.all(precacheable.map((url) => cachePut(cache, url)))

      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const existingCacheNames = await caches.keys()
      await Promise.all(
        staleCacheNames(existingCacheNames, CACHE_NAME).map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  const strategy = shellCacheStrategyFor(url, self.location.origin)
  if (strategy === null) return

  event.respondWith(strategy === 'network-first' ? networkFirst(request) : cacheFirst(request))
})

/** Precache a single URL, tolerating a failed or non-ok fetch (see cachePut). */
async function cachePut(cache: Cache, url: string): Promise<void> {
  try {
    const response = await fetch(url)
    await putIfOk(cache, url, response)
  } catch {
    // Best-effort: this install must not fail because one asset was briefly
    // unreachable. The fetch handler's own runtime caching below still
    // primes it on the next successful online load.
  }
}

/**
 * Only a genuinely successful response is ever written to the shell cache.
 * Without this, a transient 5xx (or a 404 for a since-removed asset) would be
 * stored as if it were the real shell, and an offline visit would then serve
 * that failure page indefinitely instead of the last good one.
 */
async function putIfOk(cache: Cache, request: Request | string, response: Response): Promise<void> {
  if (!response.ok) return
  await cache.put(request, response.clone())
}

/**
 * The document shell always prefers the network when it is reachable, so an
 * online visit is never held back by a stale cached HTML file referencing
 * assets from a superseded build. Offline, the last successfully cached shell
 * is what lets the human interface keep working at all.
 */
async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request)
    const cache = await caches.open(CACHE_NAME)
    await putIfOk(cache, request, response)
    return response
  } catch (error) {
    // ignoreSearch: the document is always cached under its bare path ('/'),
    // so a navigation carrying a query string (e.g. a bookmarked or
    // hand-typed URL) must still find it while offline.
    const cached = await caches.match(request, { ignoreSearch: true })
    if (cached) return cached
    throw error
  }
}

/**
 * Vite's built assets are content-hashed and therefore immutable: a given
 * hashed URL never changes what it serves, so once it is cached there is
 * never a reason to re-fetch it — cache-first is exactly right, not merely
 * fast. Priming for a first-ever build happens the first time each asset is
 * requested by the page.
 */
async function cacheFirst(request: Request): Promise<Response> {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  const cache = await caches.open(CACHE_NAME)
  await putIfOk(cache, request, response)
  return response
}
