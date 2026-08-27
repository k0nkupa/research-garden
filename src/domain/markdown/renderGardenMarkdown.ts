import MarkdownIt from 'markdown-it'
import DOMPurify from 'dompurify'

/**
 * Renders canonical Markdown for reading.
 *
 * ADR 0056 asks for two independent things, and this does both rather than
 * treating either as sufficient. Raw HTML is disabled at the parser, so markup
 * in a person's file is never interpreted; the result is then sanitized, so a
 * parser bug or a future configuration slip still cannot put active content on
 * the page. A file's presence in a selected folder does not make it trusted.
 *
 * Remote media handling and Attachment resolution are ticket 07 and are not yet
 * applied here. External link isolation is applied now, because the reading
 * panel already renders links and ADR 0056 asks for it in the same breath.
 */
const markdown = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
})

/**
 * ADR 0056: external links open with isolation from the application context.
 * Registered once, at the sanitizing boundary, so no caller can render a link
 * that reaches back into the page that opened it.
 */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element) || node.tagName !== 'A') return

  const href = node.getAttribute('href') ?? ''
  if (!/^https?:/i.test(href)) return

  node.setAttribute('target', '_blank')
  node.setAttribute('rel', 'noopener noreferrer')
})

export function renderGardenMarkdown(source: string): string {
  return DOMPurify.sanitize(markdown.render(source), {
    // Anything that executes, navigates, or loads on its own is out.
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'base', 'link'],
    FORBID_ATTR: ['style'],
    ADD_ATTR: ['target', 'rel'],
    // Blocks javascript: and data: URLs while leaving ordinary links intact.
    ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):|^[^a-z]|^[a-z+.-]*(?:[^a-z+.\-:]|$)/i,
  })
}
