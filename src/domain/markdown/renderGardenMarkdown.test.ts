/**
 * @vitest-environment jsdom
 */
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

/**
 * ADR 0057: remote media stays a visible link and is never fetched, because
 * fetching announces that this person opened this note at this moment.
 */
describe('media', () => {
  const imagesIn = (container: HTMLElement) => [...container.querySelectorAll('img')]

  it('renders no image element for a remote image', () => {
    expect(imagesIn(renderToDom('![tracker](https://evil.example/pixel.png)\n'))).toEqual([])
  })

  it('shows the remote URL as a link instead', () => {
    const anchor = renderToDom('![tracker](https://evil.example/pixel.png)\n').querySelector('a')

    expect(anchor).toHaveAttribute('href', 'https://evil.example/pixel.png')
    expect(anchor?.textContent).toContain('https://evil.example/pixel.png')
  })

  it('keeps the alt text, so the reader knows what was there', () => {
    expect(renderToDom('![a tracker](https://evil.example/p.png)\n').textContent).toContain(
      'a tracker',
    )
  })

  it('isolates that link like any other external link', () => {
    const anchor = renderToDom('![t](https://evil.example/p.png)\n').querySelector('a')

    expect(anchor).toHaveAttribute('target', '_blank')
    expect(anchor?.getAttribute('rel')).toContain('noopener')
  })

  it('renders no image for a protocol-relative URL either', () => {
    expect(imagesIn(renderToDom('![t](//evil.example/p.png)\n'))).toEqual([])
  })

  // The whole point: nothing in the output may cause a request.
  it('leaves no element carrying a remote source anywhere', () => {
    const container = renderToDom(
      ['![a](https://evil.example/1.png)', '![b](http://evil.example/2.png)'].join('\n\n'),
    )

    for (const element of [container, ...container.querySelectorAll('*')]) {
      for (const attribute of [...element.attributes]) {
        if (attribute.name === 'href') continue
        expect(attribute.value).not.toMatch(/^https?:/i)
      }
    }
  })
})

describe('Attachments', () => {
  it('renders an image element for a validated Attachment', () => {
    // The container is detached, so presence is asserted rather than document
    // membership.
    const image = renderToDom('![diagram](attachments/diagram.png)\n').querySelector('img')

    expect(image).not.toBeNull()
  })

  // Nothing loads until the file has been read out of the chosen folder.
  it('gives that image no source, so the browser fetches nothing', () => {
    const image = renderToDom('![diagram](attachments/diagram.png)\n').querySelector('img')

    expect(image).not.toHaveAttribute('src')
  })

  it('records which Attachment it is waiting for', () => {
    const image = renderToDom('![diagram](attachments/diagram.png)\n').querySelector('img')

    expect(image).toHaveAttribute('data-attachment', 'attachments/diagram.png')
  })

  it('keeps the alt text', () => {
    const image = renderToDom('![a diagram](attachments/diagram.png)\n').querySelector('img')

    expect(image).toHaveAttribute('alt', 'a diagram')
  })
})

describe('media references that are refused', () => {
  it('renders no image for a path climbing out of the Garden', () => {
    expect(renderToDom('![x](../../../etc/passwd)\n').querySelector('img')).toBeNull()
  })

  it('renders no image for an absolute path', () => {
    expect(renderToDom('![x](/etc/passwd)\n').querySelector('img')).toBeNull()
  })

  it('renders no image for a path outside the attachments directory', () => {
    expect(renderToDom('![x](roots/evidence.md)\n').querySelector('img')).toBeNull()
  })

  it('says something was there rather than dropping it silently', () => {
    expect(renderToDom('![a diagram](../secrets.png)\n').textContent).toContain('a diagram')
  })

  it('leaves no attachment marker on a refused reference', () => {
    const container = renderToDom('![x](../secrets.png)\n')

    expect(container.querySelector('[data-attachment]')).toBeNull()
  })
})

/**
 * "A relative reference that escapes the Garden Repository is refused" — links
 * as much as images. A relative href would also navigate the application away
 * and take the folder permission with it.
 */
describe('relative links', () => {
  const hrefOf = (source: string) =>
    renderToDom(source).querySelector('a')?.getAttribute('href')

  it('refuses a link climbing out of the Garden', () => {
    expect(renderToDom('[escape](../../../etc/passwd)\n').querySelector('a')).toBeNull()
  })

  it('refuses a link to an absolute path', () => {
    expect(renderToDom('[absolute](/etc/passwd)\n').querySelector('a')).toBeNull()
  })

  it('refuses a link to canonical Markdown, which is not an Attachment', () => {
    expect(renderToDom('[evidence](roots/paper.md)\n').querySelector('a')).toBeNull()
  })

  it('says what the refused link said, rather than dropping it', () => {
    expect(renderToDom('[my secrets](../secrets.txt)\n').textContent).toContain('my secrets')
  })

  // CONTEXT.md: an Attachment is any user-owned supporting file, not only an image.
  it('accepts a link to a non-image Attachment', () => {
    const anchor = renderToDom('[paper](attachments/paper.pdf)\n').querySelector('a')

    expect(anchor).toHaveAttribute('data-attachment', 'attachments/paper.pdf')
  })

  it('gives that link no href, so it cannot navigate the Garden away', () => {
    expect(hrefOf('[paper](attachments/paper.pdf)\n')).toBeNull()
  })

  it('leaves an external link alone and isolated', () => {
    const anchor = renderToDom('[out](https://example.com)\n').querySelector('a')

    expect(anchor).toHaveAttribute('href', 'https://example.com')
    expect(anchor).toHaveAttribute('target', '_blank')
  })

  it('leaves a mail link alone', () => {
    expect(hrefOf('[mail](mailto:someone@example.com)\n')).toBe('mailto:someone@example.com')
  })

  it('leaves an in-page anchor alone', () => {
    expect(hrefOf('[section](#somewhere)\n')).toBe('#somewhere')
  })
})

/**
 * ADR 0057's guarantee is that nothing fetches. The parser already escapes raw
 * HTML, so these assert the second layer independently: what survives if the
 * first one is ever reconfigured.
 */
describe('embedding vectors beyond images', () => {
  it.each(['video', 'audio', 'source', 'track', 'picture', 'iframe', 'object', 'embed'])(
    'creates no %s element',
    (tag) => {
      const container = renderToDom(`<${tag} src="https://evil.example/x"></${tag}>\n`)

      expect(container.querySelector(tag)).toBeNull()
    },
  )

  it('creates no element carrying a srcset', () => {
    const container = renderToDom('<img srcset="https://evil.example/x.png 1x">\n')

    expect(container.querySelector('[srcset]')).toBeNull()
  })

  it('creates no element carrying a ping', () => {
    const container = renderToDom('<a ping="https://evil.example/beacon" href="#">x</a>\n')

    expect(container.querySelector('[ping]')).toBeNull()
  })

  it('leaves nothing anywhere that would load a remote origin unprompted', () => {
    const hostile = [
      '<video src="https://evil.example/v.mp4"></video>',
      '<picture><source srcset="https://evil.example/s.png"></picture>',
      '<img src="https://evil.example/i.png" loading="eager">',
      '![m](https://evil.example/m.png)',
    ].join('\n\n')

    const container = renderToDom(hostile)
    for (const element of [container, ...container.querySelectorAll('*')]) {
      for (const attribute of [...element.attributes]) {
        if (attribute.name === 'href') continue
        expect(attribute.value, `${element.tagName}.${attribute.name}`).not.toMatch(/^https?:/i)
      }
    }
  })
})
