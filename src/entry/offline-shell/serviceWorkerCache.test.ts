import { describe, expect, it } from 'vitest'
import { SHELL_CACHE_PREFIX, shellCacheName, shellCacheStrategyFor, staleCacheNames } from './serviceWorkerCache'

describe('shellCacheName', () => {
  it('names the cache with the build version', () => {
    expect(shellCacheName('abc123')).toBe(`${SHELL_CACHE_PREFIX}abc123`)
  })

  it('names two different versions differently', () => {
    expect(shellCacheName('v1')).not.toBe(shellCacheName('v2'))
  })
})

describe('staleCacheNames', () => {
  it('finds nothing stale when only the current version is present', () => {
    expect(staleCacheNames([shellCacheName('v2')], shellCacheName('v2'))).toEqual([])
  })

  // ADR 0072 / this ticket: a new application version must supersede the
  // cached shell rather than being shadowed by it, so every previous shell
  // cache is a cleanup target once the new one is current.
  it('finds every previous shell cache as stale', () => {
    expect(
      staleCacheNames(
        [shellCacheName('v1'), shellCacheName('v2'), shellCacheName('v3')],
        shellCacheName('v3'),
      ),
    ).toEqual([shellCacheName('v1'), shellCacheName('v2')])
  })

  it('leaves caches outside this app entirely alone', () => {
    expect(
      staleCacheNames(['some-other-caches-api-user', shellCacheName('v1')], shellCacheName('v2')),
    ).toEqual([shellCacheName('v1')])
  })

  it('finds nothing stale when there are no caches at all', () => {
    expect(staleCacheNames([], shellCacheName('v1'))).toEqual([])
  })
})

describe('shellCacheStrategyFor', () => {
  const origin = 'https://research-garden.example'

  const documentPaths = ['/', '/index.html']
  const cacheFirstPaths = [
    '/manifest.webmanifest',
    '/icon.svg',
    '/icon-192.png',
    '/icon-512.png',
    '/icon-mask-512.png',
    '/assets/main-abc123.js',
    '/assets/main-abc123.css',
  ]

  it.each(documentPaths)('prefers the network for the document shell %s', (path) => {
    expect(shellCacheStrategyFor(new URL(path, origin), origin)).toBe('network-first')
  })

  it.each(cacheFirstPaths)('caches the immutable versioned asset %s cache-first', (path) => {
    expect(shellCacheStrategyFor(new URL(path, origin), origin)).toBe('cache-first')
  })

  it('never allows a cross-origin request, even one that looks like a shell asset', () => {
    expect(shellCacheStrategyFor(new URL('/assets/main.js', 'https://cdn.example'), origin)).toBe(
      null,
    )
  })

  /**
   * Garden files and tool results never arrive as `fetch` requests at all —
   * they come from the File System Access API and from WebMCP tool calls,
   * neither of which is HTTP — so there is no real path by which they could
   * reach this function. This case stands in for "anything not on the
   * explicit allowlist", proving the allowlist is closed rather than a
   * denylist that could admit something unnamed.
   */
  it('refuses anything outside the explicit allowlist', () => {
    expect(shellCacheStrategyFor(new URL('/some/other/path', origin), origin)).toBe(null)
  })

  it('refuses to cache the service worker script itself through the fetch handler', () => {
    expect(shellCacheStrategyFor(new URL('/sw.js', origin), origin)).toBe(null)
  })
})
