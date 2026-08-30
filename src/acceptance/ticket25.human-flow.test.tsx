/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderGardenMarkdown } from '../domain/markdown/renderGardenMarkdown'
import { App } from '../entry/App'
import { installFixtureDirectoryPicker } from './fileSystemAccessFixture'

/**
 * This is the supplementary browser-like UI seam: Testing Library drives the
 * real application, picker adapter, document/index pipeline, and accessible
 * Tree. The separate Playwright suite is the browser-driven evidence; the
 * manual real-folder Chromium boundary remains explicitly tracked in the
 * ticket.
 */
describe('Ticket 25 human flow at the application UI seam', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    Reflect.deleteProperty(window, 'showDirectoryPicker')
  })

  it('creates the Sample Garden, exposes the contradiction, and opens a claim for reading', async () => {
    const fixture = installFixtureDirectoryPicker(window, {}, 'human-flow-garden')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 900 })

    const { container } = render(<App />)
    await userEvent.click(screen.getByRole('button', { name: /create garden/i }))
    await screen.findByRole('tree')

    const claim = screen.getByRole('treeitem', { name: /Most of expertise is deliberate practice/i })
    await userEvent.click(claim)

    expect(screen.getByRole('complementary')).toHaveTextContent('Expert performance is chiefly')
    expect(container.querySelector('[data-relation="contradicts"]')).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem')).toHaveLength(8)
    expect(Object.values(fixture.directories).reduce((count, directory) => count + Object.keys(directory.files).length, 0)).toBe(8)
  })

  it('renders hostile Markdown inertly and keeps remote media as a link', () => {
    const html = renderGardenMarkdown(
      '<script>globalThis.pwned = true</script>\n\n![tracking pixel](https://evil.example/track.gif)',
    )
    const container = document.createElement('div')
    container.innerHTML = html

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('a')).toHaveAttribute('href', 'https://evil.example/track.gif')
    expect(container.querySelector('a')).not.toHaveAttribute('target', '')
  })
})
