import { ATTACHMENTS_DIRECTORY } from '../schema/itemIdentity'

/**
 * Deciding whether a reference points at an Attachment this Garden may open.
 *
 * ADR 0057 permits exactly one kind of local reference: a validated relative
 * link to a file inside the selected Garden Repository. Everything else -- a
 * remote URL, a path that climbs out of the folder, an absolute path, anything
 * carrying a scheme -- is refused, because following it would either disclose
 * that the person opened this note or reach somewhere they did not choose.
 *
 * CONTEXT.md places Attachments under `attachments/`, so a relative reference
 * pointing anywhere else in the Garden is not an Attachment either.
 */

export type MediaReference =
  | { readonly kind: 'attachment'; readonly path: readonly string[] }
  /** A remote URL: shown as a link, never loaded (ADR 0057). */
  | { readonly kind: 'remote'; readonly url: string }
  | { readonly kind: 'refused'; readonly reason: string }

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

/**
 * Markdown link destinations arrive percent-encoded, so a filename with a space
 * or any non-ASCII character reaches us escaped. Decoding is what makes those
 * files openable at all -- but it happens *after* the traversal check, because
 * decoding first would let `%2e%2e` through as `..`.
 */
function decodeSegment(segment: string): string | undefined {
  try {
    const decoded = decodeURIComponent(segment)
    // Decoding must not conjure a traversal or a separator that was not there.
    return /[/\\]/.test(decoded) || decoded === '..' || decoded === '.' ? undefined : decoded
  } catch {
    return undefined
  }
}

export function classifyMediaReference(reference: string): MediaReference {
  const trimmed = reference.trim()

  if (trimmed === '') return { kind: 'refused', reason: 'names nothing' }

  if (HAS_SCHEME.test(trimmed)) {
    return /^https?:/i.test(trimmed)
      ? { kind: 'remote', url: trimmed }
      : { kind: 'refused', reason: 'uses a scheme Research Garden will not open' }
  }

  // A protocol-relative URL is remote in everything but spelling.
  if (trimmed.startsWith('//')) return { kind: 'remote', url: `https:${trimmed}` }

  if (trimmed.startsWith('/')) {
    return { kind: 'refused', reason: 'is an absolute path, which leaves the Garden' }
  }

  // A query or fragment belongs to a URL, not to a file in a folder.
  const withoutQuery = trimmed.replace(/[?#].*$/, '')

  const segments = withoutQuery
    .replace(/^\.\//, '')
    .split('/')
    .filter((segment) => segment !== '')

  if (segments.some((segment) => segment === '..' || segment === '.')) {
    return { kind: 'refused', reason: 'climbs outside the Garden Repository' }
  }

  const decoded = segments.map(decodeSegment)
  if (decoded.some((segment) => segment === undefined)) {
    return { kind: 'refused', reason: 'is not a readable relative path' }
  }
  const path = decoded as string[]

  if (path[0] !== ATTACHMENTS_DIRECTORY) {
    return {
      kind: 'refused',
      reason: `is not under ${ATTACHMENTS_DIRECTORY}/, where Attachments live`,
    }
  }

  if (path.length < 2) {
    return { kind: 'refused', reason: 'names a directory rather than a file' }
  }

  return { kind: 'attachment', path }
}

/**
 * The image formats an Attachment may be shown inline as.
 *
 * SVG is deliberately absent. It is a document format that can carry script,
 * and an Attachment is untrusted like everything else in a person's folder
 * (ADR 0056). Anything not listed here is still openable as a file; it just is
 * not painted into the page.
 */
const INLINE_IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
}

export function inlineImageTypeFor(path: string): string | undefined {
  return INLINE_IMAGE_TYPES[path.split('.').pop()?.toLowerCase() ?? '']
}
