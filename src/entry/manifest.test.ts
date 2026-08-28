import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Chrome/Edge desktop installability criteria (ADR 0064 scopes browser
 * support to current desktop Chromium): a manifest with `name`, icons
 * including a 192x192 and a 512x512, `start_url`, and a standalone-family
 * `display`, served alongside a registered service worker. This test covers
 * everything about the manifest a unit test can check; actual installability
 * (including that the service worker is registered and reachable) is verified
 * in a real browser per the ticket's Notes.
 */
const manifest = JSON.parse(
  readFileSync(join('public', 'manifest.webmanifest'), 'utf8'),
) as {
  name?: string
  short_name?: string
  start_url?: string
  display?: string
  background_color?: string
  theme_color?: string
  icons?: { src: string; sizes: string; type: string; purpose?: string }[]
}

describe('the web app manifest (ADR 0064 installability)', () => {
  it('names the app', () => {
    expect(manifest.name).toBeTruthy()
    expect(manifest.short_name).toBeTruthy()
  })

  it('declares a standalone-family display mode', () => {
    expect(['standalone', 'fullscreen', 'minimal-ui']).toContain(manifest.display)
  })

  it('declares a start_url', () => {
    expect(manifest.start_url).toBeTruthy()
  })

  it('includes a 192x192 icon Chrome/Edge require for installability', () => {
    expect(manifest.icons?.some((icon) => icon.sizes === '192x192')).toBe(true)
  })

  it('includes a 512x512 icon Chrome/Edge require for installability', () => {
    expect(manifest.icons?.some((icon) => icon.sizes === '512x512')).toBe(true)
  })

  it('includes a maskable icon for adaptive-icon platforms', () => {
    expect(manifest.icons?.some((icon) => icon.purpose === 'maskable')).toBe(true)
  })

  it('references only icon files that actually exist under public/', () => {
    for (const icon of manifest.icons ?? []) {
      const path = join('public', icon.src.replace(/^\//, ''))
      expect(existsSync(path), `${icon.src} is declared but missing at ${path}`).toBe(true)
    }
  })

  it('references no remote icon origin', () => {
    for (const icon of manifest.icons ?? []) {
      expect(icon.src).not.toMatch(/^https?:\/\//)
    }
  })
})
