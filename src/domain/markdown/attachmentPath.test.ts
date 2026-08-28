import { describe, expect, it } from 'vitest'
import { classifyMediaReference, inlineImageTypeFor } from './attachmentPath'

// ADR 0057: exactly one kind of media renders — a validated relative link to a
// file inside the selected Garden Repository.
describe('references that are Attachments', () => {
  it('accepts a file under attachments', () => {
    expect(classifyMediaReference('attachments/diagram.png')).toEqual({
      kind: 'attachment',
      path: ['attachments', 'diagram.png'],
    })
  })

  it('accepts a nested Attachment', () => {
    expect(classifyMediaReference('attachments/figures/one.png')).toMatchObject({
      kind: 'attachment',
      path: ['attachments', 'figures', 'one.png'],
    })
  })

  it('normalizes a leading current-directory marker', () => {
    expect(classifyMediaReference('./attachments/diagram.png')).toMatchObject({
      kind: 'attachment',
      path: ['attachments', 'diagram.png'],
    })
  })

  it('ignores surrounding whitespace', () => {
    expect(classifyMediaReference('  attachments/diagram.png  ')).toMatchObject({
      kind: 'attachment',
    })
  })
})

// ADR 0057: remote media stays a link, so opening a note never announces it.
describe('references that are remote', () => {
  it('treats an https URL as remote', () => {
    expect(classifyMediaReference('https://example.com/pixel.png')).toEqual({
      kind: 'remote',
      url: 'https://example.com/pixel.png',
    })
  })

  it('treats an http URL as remote', () => {
    expect(classifyMediaReference('http://example.com/pixel.png')).toMatchObject({
      kind: 'remote',
    })
  })

  it('treats a protocol-relative URL as remote, not as a path', () => {
    expect(classifyMediaReference('//evil.example/pixel.png')).toMatchObject({
      kind: 'remote',
      url: 'https://evil.example/pixel.png',
    })
  })
})

describe('references that are refused', () => {
  it('refuses a path climbing out of the Garden', () => {
    expect(classifyMediaReference('../../../etc/passwd')).toMatchObject({ kind: 'refused' })
  })

  it('refuses a climb hidden inside an otherwise valid path', () => {
    expect(classifyMediaReference('attachments/../../secrets.png')).toMatchObject({
      kind: 'refused',
    })
  })

  it('refuses an absolute path', () => {
    expect(classifyMediaReference('/etc/passwd')).toMatchObject({ kind: 'refused' })
  })

  it('refuses a data URL, which could carry markup', () => {
    expect(classifyMediaReference('data:text/html;base64,PHNjcmlwdD4=')).toMatchObject({
      kind: 'refused',
    })
  })

  it('refuses a javascript URL', () => {
    expect(classifyMediaReference('javascript:alert(1)')).toMatchObject({ kind: 'refused' })
  })

  it('refuses a file URL', () => {
    expect(classifyMediaReference('file:///etc/passwd')).toMatchObject({ kind: 'refused' })
  })

  // Canonical Markdown is not an Attachment, and neither is anything else in
  // the Garden: Attachments live under attachments/.
  it('refuses a relative path outside the attachments directory', () => {
    expect(classifyMediaReference('roots/evidence.md')).toMatchObject({ kind: 'refused' })
  })

  it('refuses the attachments directory itself', () => {
    expect(classifyMediaReference('attachments/')).toMatchObject({ kind: 'refused' })
  })

  it('refuses an empty reference', () => {
    expect(classifyMediaReference('   ')).toMatchObject({ kind: 'refused' })
  })

  it('explains why it refused, so the reason can be shown', () => {
    const refusal = classifyMediaReference('../secrets.png')

    expect(refusal.kind).toBe('refused')
    if (refusal.kind === 'refused') expect(refusal.reason).toBeTruthy()
  })
})

/**
 * Markdown link destinations arrive percent-encoded, so a filename with a space
 * or any non-ASCII character reaches the classifier escaped. Decoding is what
 * makes those files openable at all.
 */
describe('percent-encoded references', () => {
  it('decodes an accented filename', () => {
    expect(classifyMediaReference('attachments/caf%C3%A9.png')).toEqual({
      kind: 'attachment',
      path: ['attachments', 'café.png'],
    })
  })

  it('decodes a filename containing a space', () => {
    expect(classifyMediaReference('attachments/my%20photo.png')).toMatchObject({
      path: ['attachments', 'my photo.png'],
    })
  })

  // Decoding must not conjure a traversal that was not written.
  it('refuses an encoded parent traversal', () => {
    expect(classifyMediaReference('attachments/%2e%2e/%2e%2e/secrets.png')).toMatchObject({
      kind: 'refused',
    })
  })

  it('refuses an encoded separator smuggled into a segment', () => {
    expect(classifyMediaReference('attachments/a%2Fb%2F..%2Fsecret.png')).toMatchObject({
      kind: 'refused',
    })
  })

  it('refuses an encoded backslash', () => {
    expect(classifyMediaReference('attachments/a%5C..%5Csecret.png')).toMatchObject({
      kind: 'refused',
    })
  })

  it('refuses a malformed encoding rather than guessing', () => {
    expect(classifyMediaReference('attachments/%E0%A4%A.png')).toMatchObject({ kind: 'refused' })
  })

  it('refuses an encoded directory name that decodes to attachments', () => {
    // The first segment is compared after decoding, so this is an Attachment.
    expect(classifyMediaReference('%61ttachments/x.png')).toMatchObject({ kind: 'attachment' })
  })
})

describe('references carrying a query or fragment', () => {
  it('ignores a query string, which belongs to a URL rather than a file', () => {
    expect(classifyMediaReference('attachments/x.png?v=2')).toEqual({
      kind: 'attachment',
      path: ['attachments', 'x.png'],
    })
  })

  it('ignores a fragment', () => {
    expect(classifyMediaReference('attachments/x.png#page=2')).toMatchObject({
      path: ['attachments', 'x.png'],
    })
  })
})

// ADR 0056: SVG is a document format that can carry script.
describe('which Attachments may be shown inline', () => {
  it.each(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'])('shows a %s inline', (extension) => {
    expect(inlineImageTypeFor(`attachments/x.${extension}`)).toBeTruthy()
  })

  it('refuses to show an SVG inline', () => {
    expect(inlineImageTypeFor('attachments/logo.svg')).toBeUndefined()
  })

  it('refuses to show a PDF inline', () => {
    expect(inlineImageTypeFor('attachments/paper.pdf')).toBeUndefined()
  })

  it('ignores case in the extension', () => {
    expect(inlineImageTypeFor('attachments/X.PNG')).toBe('image/png')
  })

  it('refuses a file with no extension', () => {
    expect(inlineImageTypeFor('attachments/README')).toBeUndefined()
  })
})
