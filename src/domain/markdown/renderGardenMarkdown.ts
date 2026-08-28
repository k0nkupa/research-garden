import MarkdownIt from 'markdown-it'
import createDOMPurify from 'dompurify'
import { classifyMediaReference } from './attachmentPath'

/**
 * Renders canonical Markdown for reading.
 *
 * ADR 0056 asks for two independent things, and this does both rather than
 * treating either as sufficient. Raw HTML is disabled at the parser, so markup
 * in a person's file is never interpreted; the result is then sanitized, so a
 * parser bug or a future configuration slip still cannot put active content on
 * the page. A file's presence in a selected folder does not make it trusted.
 *
 * References are then handled separately, because sanitizing is not enough for
 * them. A perfectly well-formed remote image is dangerous for a different
 * reason: it would fetch, and fetching announces that this person opened this
 * note at this moment to whoever serves it. ADR 0057 therefore leaves remote
 * media as a visible link, refuses any relative reference that leaves the
 * Garden Repository, and emits Attachments with no source at all -- nothing
 * loads until the file has been read out of the folder the person selected.
 */
const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
})

/** Marks a node awaiting bytes from the Garden Repository. */
export const ATTACHMENT_ATTRIBUTE = 'data-attachment'

/**
 * Anything that executes, navigates, or loads on its own.
 *
 * The media tags are here even though `html: false` means markdown-it can never
 * emit them. The point of a second layer is that it holds when the first one
 * does not, and "remote media is never fetched" is the guarantee that would
 * quietly break if the parser were ever reconfigured.
 */
const FORBIDDEN_TAGS = [
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'base',
  'link',
  'video',
  'audio',
  'source',
  'track',
  'picture',
]

/** Attributes that fetch or beacon without any interaction. */
const FORBIDDEN_ATTRIBUTES = ['style', 'srcset', 'ping', 'loading', 'poster', 'background']

let purifier: ReturnType<typeof createDOMPurify> | undefined

/**
 * A purifier of our own rather than the shared singleton, so registering the
 * link hook cannot change how anything else in the page sanitizes. Created on
 * first use because a DOM has to exist for it to be built at all.
 */
function sanitizer() {
  if (purifier) return purifier

  purifier = createDOMPurify()
  // ADR 0056: external links open with isolation from the application context.
  purifier.addHook('afterSanitizeAttributes', (node) => {
    if (node instanceof Element && node.tagName === 'A') isolateIfExternal(node)
  })
  return purifier
}

function isolateIfExternal(anchor: Element): void {
  if (!/^https?:/i.test(anchor.getAttribute('href') ?? '')) return

  anchor.setAttribute('target', '_blank')
  anchor.setAttribute('rel', 'noopener noreferrer')
}

/** Says what was meant to be there, so nothing disappears silently. */
function refusedNode(document: Document, described: string): Element {
  const span = document.createElement('span')
  span.setAttribute('class', 'refused-media')
  span.textContent = described
  return span
}

/**
 * Leaves nothing in the output that could fetch, navigate away, or reach
 * outside the Garden Repository on its own.
 *
 * Run after sanitizing rather than as a hook, because most outcomes replace the
 * element with a different one, which a hook cannot do.
 */
function disarmReferences(fragment: DocumentFragment): void {
  const document = fragment.ownerDocument

  for (const image of [...fragment.querySelectorAll('img')]) {
    const alt = image.getAttribute('alt') ?? ''
    const reference = classifyMediaReference(image.getAttribute('src') ?? '')

    if (reference.kind === 'attachment') {
      // Deliberately no `src`: the panel supplies one only after reading the
      // file out of the Garden Repository.
      image.removeAttribute('src')
      image.setAttribute(ATTACHMENT_ATTRIBUTE, reference.path.join('/'))
      continue
    }

    if (reference.kind === 'remote') {
      const link = document.createElement('a')
      link.setAttribute('href', reference.url)
      link.setAttribute('class', 'remote-media')
      isolateIfExternal(link)
      link.textContent = alt === '' ? reference.url : `${alt} (${reference.url})`
      image.replaceWith(link)
      continue
    }

    image.replaceWith(refusedNode(document, alt === '' ? '[unavailable image]' : `[${alt}]`))
  }

  for (const anchor of [...fragment.querySelectorAll('a')]) {
    const href = anchor.getAttribute('href') ?? ''

    // Remote links, mail, and telephone are the sanitizer's business and are
    // already isolated; only relative references are decided here.
    if (/^(?:https?|mailto|tel):/i.test(href) || href.startsWith('#')) continue

    const reference = classifyMediaReference(href)

    if (reference.kind === 'attachment') {
      // Same treatment as an image: no href until the file has been read. A
      // relative href would otherwise navigate the application away and take
      // the folder permission with it.
      anchor.removeAttribute('href')
      anchor.setAttribute(ATTACHMENT_ATTRIBUTE, reference.path.join('/'))
      continue
    }

    if (reference.kind === 'remote') {
      anchor.setAttribute('href', reference.url)
      isolateIfExternal(anchor)
      continue
    }

    anchor.replaceWith(refusedNode(document, anchor.textContent ?? '[unavailable link]'))
  }
}

export function renderGardenMarkdown(source: string): string {
  const fragment = sanitizer().sanitize(markdown.render(source), {
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
    ADD_ATTR: ['target', 'rel'],
    // Blocks javascript: and data: URLs while leaving ordinary links intact.
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):|^[^a-z]|^[a-z+.-]*(?:[^a-z+.\-:]|$)/i,
    RETURN_DOM_FRAGMENT: true,
  })

  disarmReferences(fragment)

  const container = fragment.ownerDocument.createElement('div')
  container.append(fragment)
  return container.innerHTML
}
