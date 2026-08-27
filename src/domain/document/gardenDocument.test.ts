import { describe, expect, it } from 'vitest'
import { parseGardenDocument, serializeGardenDocument, setFrontmatterField } from './gardenDocument'

const wellFormed = `---
schema_version: 1
id: branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W
kind: branch
title: Attention mechanisms
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
---

Everything I am collecting about attention.
`

function expectParsed(text: string) {
  const result = parseGardenDocument(text)
  if (!result.ok) throw new Error(`expected a parsed document, got ${result.error.code}`)
  return result.document
}

describe('parsing', () => {
  it('reads frontmatter fields as data', () => {
    const document = expectParsed(wellFormed)

    expect(document.frontmatter).toMatchObject({
      schema_version: 1,
      kind: 'branch',
      title: 'Attention mechanisms',
      state: 'active',
    })
  })

  it('reads the body separately from the frontmatter', () => {
    expect(expectParsed(wellFormed).body).toBe(
      '\nEverything I am collecting about attention.\n',
    )
  })

  it('accepts a document with an empty body', () => {
    const document = expectParsed('---\nkind: branch\n---\n')

    expect(document.body).toBe('')
    expect(document.frontmatter).toMatchObject({ kind: 'branch' })
  })

  it('rejects a file with no frontmatter', () => {
    const result = parseGardenDocument('# Just a heading\n')

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-frontmatter' } })
  })

  it('rejects a file whose frontmatter is never closed', () => {
    const result = parseGardenDocument('---\nkind: branch\n\nbody\n')

    expect(result).toMatchObject({ ok: false, error: { code: 'missing-frontmatter' } })
  })

  it('rejects malformed YAML in the frontmatter', () => {
    const result = parseGardenDocument('---\nkind: [unclosed\n---\n\nbody\n')

    expect(result).toMatchObject({ ok: false, error: { code: 'malformed-frontmatter' } })
  })

  it('rejects frontmatter that is not a mapping', () => {
    const result = parseGardenDocument('---\n- one\n- two\n---\n\nbody\n')

    expect(result).toMatchObject({ ok: false, error: { code: 'malformed-frontmatter' } })
  })
})

// ADR 0054 and ADR 0078: Research Garden is not the exclusive editor of these
// files, so anything it does not understand must survive a read/write cycle.
describe('round tripping', () => {
  /**
   * An unchanged document is re-emitted from the text it was read from, so
   * asserting on it alone would prove nothing. Forcing a re-emit through a no-op
   * edit is what actually exercises the document model.
   */
  function reserializeThroughTheModel(text: string): string {
    const document = expectParsed(text)
    const title = document.frontmatter['title']
    return serializeGardenDocument(setFrontmatterField(document, 'title', title))
  }

  it('serializes an unchanged document byte-for-byte', () => {
    expect(serializeGardenDocument(expectParsed(wellFormed))).toBe(wellFormed)
  })

  it('reproduces the file from the document model, not only from the original text', () => {
    expect(reserializeThroughTheModel(wellFormed)).toBe(wellFormed)
  })

  it('reproduces unknown fields from the document model', () => {
    const withExtensions = `---
kind: branch
title: Attention
my_own_field: kept
nested:
  reading_order: 3
---

Body.
`
    expect(reserializeThroughTheModel(withExtensions)).toBe(withExtensions)
  })

  it('reproduces comments from the document model', () => {
    const withComments = `---
# why this Branch exists
kind: branch
title: Attention
---

Body.
`
    expect(reserializeThroughTheModel(withComments)).toBe(withComments)
  })

  it('preserves an unchanged document that carries unknown fields', () => {
    const withExtensions = `---
kind: branch
title: Attention
my_own_field: kept
nested:
  reading_order: 3
---

Body.
`
    expect(serializeGardenDocument(expectParsed(withExtensions))).toBe(withExtensions)
  })

  it('preserves an unchanged document that carries comments', () => {
    const withComments = `---
# why this Branch exists
kind: branch
title: Attention # inline note
---

Body.
`
    expect(serializeGardenDocument(expectParsed(withComments))).toBe(withComments)
  })

  it('preserves unusual but valid body content unchanged', () => {
    const trickyBody = `---
kind: branch
---

A body containing --- a horizontal rule marker
and trailing whitespace.   
`
    expect(serializeGardenDocument(expectParsed(trickyBody))).toBe(trickyBody)
  })
})

describe('editing one field', () => {
  const withExtras = `---
# a leading comment
kind: branch
title: Old title # an inline comment
my_own_field: kept
---

Body text that must not move.
`

  it('changes the requested field', () => {
    const edited = setFrontmatterField(expectParsed(withExtras), 'title', 'New title')

    expect(edited.frontmatter).toMatchObject({ title: 'New title' })
  })

  it('keeps unknown fields', () => {
    const edited = setFrontmatterField(expectParsed(withExtras), 'title', 'New title')

    expect(serializeGardenDocument(edited)).toContain('my_own_field: kept')
  })

  it('keeps comments', () => {
    const output = serializeGardenDocument(
      setFrontmatterField(expectParsed(withExtras), 'title', 'New title'),
    )

    expect(output).toContain('# a leading comment')
    expect(output).toContain('# an inline comment')
  })

  it('leaves the body untouched', () => {
    const output = serializeGardenDocument(
      setFrontmatterField(expectParsed(withExtras), 'title', 'New title'),
    )

    expect(output).toContain('\nBody text that must not move.\n')
  })

  it('adds a field that was not present without disturbing the rest', () => {
    const output = serializeGardenDocument(
      setFrontmatterField(expectParsed(withExtras), 'state', 'dormant'),
    )

    expect(output).toContain('state: dormant')
    expect(output).toContain('my_own_field: kept')
    expect(output).toContain('# a leading comment')
  })

  it('does not mutate the document it was given', () => {
    const original = expectParsed(withExtras)

    setFrontmatterField(original, 'title', 'New title')

    expect(original.frontmatter).toMatchObject({ title: 'Old title' })
    expect(serializeGardenDocument(original)).toBe(withExtras)
  })

  // ADR 0078: an edit to one known field must not normalize the rest of the file.
  it('differs from the original only in the edited line', () => {
    const output = serializeGardenDocument(
      setFrontmatterField(expectParsed(withExtras), 'title', 'New title'),
    )

    const before = withExtras.split('\n')
    const after = output.split('\n')
    const changed = before
      .map((line, index) => (line === after[index] ? null : index))
      .filter((index): index is number => index !== null)

    expect(changed).toHaveLength(1)
    expect(before[changed[0] as number]).toContain('Old title')
    expect(after[changed[0] as number]).toContain('New title')
  })

  it('produces a document that parses again', () => {
    const edited = setFrontmatterField(expectParsed(withExtras), 'title', 'New title')

    expect(expectParsed(serializeGardenDocument(edited)).frontmatter).toMatchObject({
      title: 'New title',
      my_own_field: 'kept',
    })
  })
})
