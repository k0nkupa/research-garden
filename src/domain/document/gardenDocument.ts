import { Document, parseDocument, isMap, stringify } from 'yaml'

/**
 * The document model for canonical Garden Markdown.
 *
 * ADR 0054 and ADR 0078 make one demand of this layer: Research Garden is not
 * the exclusive editor of a person's files, so unknown frontmatter fields,
 * comments, and body text it did not touch must survive a read and write cycle
 * intact. That rules out parse-to-object-and-reserialize; the YAML document
 * model is kept alive so edits are surgical.
 */

export interface GardenDocument {
  /** Frontmatter as plain data, for schema validation. Never written back from. */
  readonly frontmatter: Record<string, unknown>
  /** Everything after the closing delimiter, verbatim. */
  readonly body: string
  /** The live YAML document, retained so edits keep comments and unknown fields. */
  readonly yaml: Document
  /** The exact original text, so an untouched document serializes byte-for-byte. */
  readonly originalText: string | undefined
}

export type DocumentParseErrorCode = 'missing-frontmatter' | 'malformed-frontmatter'

export interface DocumentParseError {
  readonly code: DocumentParseErrorCode
  readonly message: string
}

export type DocumentParseResult =
  | { readonly ok: true; readonly document: GardenDocument }
  | { readonly ok: false; readonly error: DocumentParseError }

const OPENING = /^---\r?\n/
const CLOSING = /\r?\n---(\r?\n|$)/

function failure(code: DocumentParseErrorCode, message: string): DocumentParseResult {
  return { ok: false, error: { code, message } }
}

export function parseGardenDocument(text: string): DocumentParseResult {
  const opening = OPENING.exec(text)
  if (!opening) {
    return failure('missing-frontmatter', 'The file does not begin with a frontmatter block.')
  }

  const afterOpening = text.slice(opening[0].length)
  const closing = CLOSING.exec(afterOpening)
  if (!closing) {
    return failure('missing-frontmatter', 'The frontmatter block is never closed.')
  }

  const frontmatterText = afterOpening.slice(0, closing.index)
  const body = afterOpening.slice(closing.index + closing[0].length)

  const yaml = parseDocument(frontmatterText)
  if (yaml.errors.length > 0) {
    return failure('malformed-frontmatter', yaml.errors[0]?.message ?? 'Invalid YAML.')
  }
  if (!isMap(yaml.contents)) {
    return failure('malformed-frontmatter', 'Frontmatter must be a mapping of fields.')
  }

  return {
    ok: true,
    document: {
      frontmatter: (yaml.toJS() ?? {}) as Record<string, unknown>,
      body,
      yaml,
      originalText: text,
    },
  }
}

export function serializeGardenDocument(document: GardenDocument): string {
  // An untouched document is re-emitted exactly as it was read, so opening a
  // Garden and writing an unrelated item can never reformat a person's file.
  if (document.originalText !== undefined) return document.originalText

  return `---\n${document.yaml.toString()}---\n${document.body}`
}

/**
 * Returns a new document with one frontmatter field set.
 *
 * The YAML document is cloned and edited in place rather than rebuilt, which is
 * what keeps comments, field order, and unknown fields (ADR 0078). Dropping
 * `originalText` marks the document as changed so serialization re-emits it.
 */
export function setFrontmatterField(
  document: GardenDocument,
  field: string,
  value: unknown,
): GardenDocument {
  const yaml = document.yaml.clone() as Document
  yaml.set(field, value)

  return {
    frontmatter: (yaml.toJS() ?? {}) as Record<string, unknown>,
    body: document.body,
    yaml,
    originalText: undefined,
  }
}

/**
 * Returns a new document with the body replaced.
 *
 * The frontmatter's live YAML is carried over untouched -- comments, unknown
 * fields, and field order all survive -- so a body-only edit (ticket 12) never
 * disturbs frontmatter it did not touch. Dropping `originalText` marks the
 * document as changed, the same way `setFrontmatterField` does.
 *
 * Unlike `setFrontmatterField`, the YAML document itself is not cloned here:
 * this function never mutates it, and `setFrontmatterField` always clones
 * before it sets a field, so sharing the reference cannot let an edit through
 * one of these functions leak into a document reached through the other.
 */
export function setBody(document: GardenDocument, body: string): GardenDocument {
  return {
    frontmatter: document.frontmatter,
    body,
    yaml: document.yaml,
    originalText: undefined,
  }
}

/**
 * Writes a brand-new canonical file.
 *
 * ADR 0078 gives new files a documented field order while leaving existing
 * files alone, so a Garden Research Garden created reads the same way every
 * time without it ever reformatting a file a person wrote. Fields the order
 * does not name are kept, in the order they were given, rather than dropped --
 * the same tolerance ADR 0054 asks for on read.
 */
export function serializeNewGardenDocument(
  frontmatter: Record<string, unknown>,
  body: string,
  fieldOrder: readonly string[],
): string {
  const present = Object.entries(frontmatter).filter(([, value]) => value !== undefined)
  const rank = new Map(fieldOrder.map((field, at) => [field, at]))

  const ordered: Record<string, unknown> = {}
  for (const [field] of [...present].sort(
    ([a], [b]) => (rank.get(a) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b) ?? Number.MAX_SAFE_INTEGER),
  )) {
    ordered[field] = frontmatter[field]
  }

  // A body that already ends in a newline must not gain a second one, and one
  // that does not must gain its first: a canonical file ends with exactly one.
  const separated = body === '' ? '' : `\n${body.replace(/\n*$/, '\n')}`

  return `---\n${stringify(ordered)}---\n${separated}`
}
