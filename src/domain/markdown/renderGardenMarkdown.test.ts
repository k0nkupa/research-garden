import { describe, expect, it } from 'vitest'
import { renderGardenMarkdown } from './renderGardenMarkdown'

/**
 * Safety is asserted against the parsed DOM rather than the HTML string.
 * Escaped text that merely contains the characters of a script tag is inert,
 * and a substring assertion would fail on it while missing a real live element.
 * What matters is whether anything in the result can execute, navigate, or load.
 */
function renderToDom(source: string): HTMLElement {
  const container = document.createElement('div')
  container.innerHTML = renderGardenMarkdown(source)
  return container
}

function elementsIn(container: HTMLElement): readonly Element[] {
  return [container, ...container.querySelectorAll('*')]
}

function activeAttributesIn(container: HTMLElement): readonly string[] {
  return elementsIn(container).flatMap((element) =>
    [...element.attributes]
      .map((attribute) => attribute.name)
      .filter((name) => name.startsWith('on')),
  )
}

function hrefsIn(container: HTMLElement): readonly string[] {
  return [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href') ?? '')
}

describe('rendering canonical Markdown', () => {
  it('renders headings', () => {
    expect(renderGardenMarkdown('# A heading\n')).toContain('<h1>A heading</h1>')
  })

  it('renders emphasis', () => {
    expect(renderGardenMarkdown('*emphasis*\n')).toContain('<em>emphasis</em>')
  })

  it('renders lists', () => {
    const html = renderGardenMarkdown('- one\n- two\n')

    expect(html).toContain('<ul>')
    expect(html).toContain('<li>one</li>')
  })

  it('renders code blocks', () => {
    expect(renderGardenMarkdown('```\nconst x = 1\n```\n')).toContain('<code>')
  })

  it('renders an ordinary link', () => {
    expect(hrefsIn(renderToDom('[a link](https://example.com)\n'))).toEqual([
      'https://example.com',
    ])
  })

  it('renders an empty body as empty output', () => {
    expect(renderGardenMarkdown('').trim()).toBe('')
  })
})

/**
 * ADR 0056: canonical Markdown is untrusted input. A file's presence in a
 * folder the person selected does not make its active content trustworthy.
 */
describe('treating canonical Markdown as untrusted', () => {
  it('does not turn raw HTML in the source into elements', () => {
    const container = renderToDom('<div id="injected">raw</div>\n')

    expect(container.querySelector('#injected')).toBeNull()
  })

  it('shows raw HTML from the source as visible text instead', () => {
    expect(renderToDom('<div id="injected">raw</div>\n').textContent).toContain(
      '<div id="injected">',
    )
  })

  it('creates no script element', () => {
    const container = renderToDom('<script>globalThis.owned = true</script>\n')

    expect(container.querySelector('script')).toBeNull()
  })

  it('creates no inline event handler', () => {
    const container = renderToDom('<img src="x" onerror="globalThis.owned = true">\n')

    expect(activeAttributesIn(container)).toEqual([])
  })

  it('creates no iframe', () => {
    expect(renderToDom('<iframe src="https://example.com"></iframe>\n').querySelector('iframe'))
      .toBeNull()
  })

  it('creates no style element', () => {
    expect(renderToDom('<style>body { display: none }</style>\n').querySelector('style')).toBeNull()
  })

  it('creates no link carrying a javascript: URL', () => {
    const container = renderToDom('[click](javascript:globalThis.owned=true)\n')

    expect(hrefsIn(container).filter((href) => href.toLowerCase().includes('javascript:'))).toEqual(
      [],
    )
  })

  it('creates no link carrying a data: URL', () => {
    const container = renderToDom('[click](data:text/html;base64,PHNjcmlwdD4=)\n')

    expect(hrefsIn(container).filter((href) => href.toLowerCase().startsWith('data:'))).toEqual([])
  })

  it('creates no script from an inline svg', () => {
    const container = renderToDom('<svg><script>globalThis.owned = true</script></svg>\n')

    expect(container.querySelector('script')).toBeNull()
  })

  it('leaves no active attribute anywhere in a hostile document', () => {
    const hostile = [
      '<img src=x onerror=alert(1)>',
      '<body onload=alert(1)>',
      '<a href="javascript:alert(1)" onclick="alert(1)">x</a>',
      '<svg/onload=alert(1)>',
      '[a](javascript:alert(1))',
      '![i](javascript:alert(1))',
    ].join('\n\n')

    expect(activeAttributesIn(renderToDom(hostile))).toEqual([])
    expect(hrefsIn(renderToDom(hostile)).filter((href) => href.includes('javascript:'))).toEqual([])
  })

  // ADR 0056: external links open with isolation from the application context.
  it('isolates an external link from the page that opened it', () => {
    const anchor = renderToDom('[a link](https://example.com)\n').querySelector('a')

    expect(anchor).toHaveAttribute('target', '_blank')
    expect(anchor?.getAttribute('rel')).toContain('noopener')
    expect(anchor?.getAttribute('rel')).toContain('noreferrer')
  })

  it('leaves a relative link alone, since it stays inside the Garden', () => {
    const anchor = renderToDom('[an attachment](attachments/paper.pdf)\n').querySelector('a')

    expect(anchor).not.toHaveAttribute('target')
  })

  it('leaves ordinary prose that merely mentions markup readable', () => {
    const html = renderGardenMarkdown('Use the `<script>` tag carefully.\n')

    expect(html).toContain('<code>')
    expect(renderToDom('Use the `<script>` tag carefully.\n').textContent).toContain('<script>')
  })
})
