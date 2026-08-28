import { describe, expect, it } from 'vitest'
import type { RootItem } from './gardenItem'
import {
  ROOT_EVIDENCE_FIELDS,
  ROOT_METADATA_FIELDS,
  isBodyEditableKind,
  rootEvidenceChanges,
  wouldRewriteRootEvidence,
} from './rootEvidence'

const captured: RootItem = {
  schemaVersion: 1,
  id: 'root_01HQ8X2K3M4N5P6Q7R8S9T0V1W',
  kind: 'root',
  title: 'A paper on attention',
  parentId: undefined,
  relations: [],
  createdAt: '2026-08-01T10:00:00Z',
  updatedAt: '2026-08-01T10:00:00Z',
  body: 'The exact words that were captured.\n',
  originUrl: 'https://example.com/paper',
  capturedAt: '2026-08-01T09:00:00Z',
  contentHash: 'sha256:abc123',
  attribution: undefined,
}

// ADR 0012: a Root's captured evidence is immutable after creation, so later
// reasoning cannot silently rewrite what earlier conclusions were built on.
describe('changes that rewrite evidence', () => {
  it('reports a changed excerpt', () => {
    const rewritten = { ...captured, body: 'Words it never said.\n' }

    expect(rootEvidenceChanges(captured, rewritten)).toEqual([
      { field: 'body', from: captured.body, to: 'Words it never said.\n' },
    ])
  })

  it('reports a changed content hash', () => {
    const rewritten = { ...captured, contentHash: 'sha256:different' }

    expect(wouldRewriteRootEvidence(captured, rewritten)).toBe(true)
  })

  it('reports a changed capture time', () => {
    const rewritten = { ...captured, capturedAt: '2020-01-01T00:00:00Z' }

    expect(wouldRewriteRootEvidence(captured, rewritten)).toBe(true)
  })

  it('reports every rewritten field, not only the first', () => {
    const rewritten = { ...captured, body: 'other', contentHash: 'sha256:other' }

    expect(rootEvidenceChanges(captured, rewritten).map((change) => change.field).sort()).toEqual([
      'body',
      'contentHash',
    ])
  })

  it('says what the value would have become, so an approval surface can show it', () => {
    const rewritten = { ...captured, contentHash: 'sha256:different' }

    expect(rootEvidenceChanges(captured, rewritten)[0]).toMatchObject({
      from: 'sha256:abc123',
      to: 'sha256:different',
    })
  })
})

// ADR 0012: only metadata may be corrected through an approved change.
describe('corrections that touch metadata only', () => {
  it('permits correcting the title', () => {
    expect(wouldRewriteRootEvidence(captured, { ...captured, title: 'A better title' })).toBe(false)
  })

  it('permits correcting a mistyped origin URL', () => {
    const corrected = { ...captured, originUrl: 'https://example.com/the-real-paper' }

    expect(wouldRewriteRootEvidence(captured, corrected)).toBe(false)
  })

  it('permits adding attribution that was missing', () => {
    expect(
      wouldRewriteRootEvidence(captured, { ...captured, attribution: 'A. Researcher' }),
    ).toBe(false)
  })

  it('permits recording that the item was edited', () => {
    const touched = { ...captured, updatedAt: '2026-09-01T10:00:00Z' }

    expect(wouldRewriteRootEvidence(captured, touched)).toBe(false)
  })

  it('reports no change when nothing changed', () => {
    expect(rootEvidenceChanges(captured, { ...captured })).toEqual([])
  })
})

describe('the partition itself', () => {
  it('assigns every evidence field and metadata field distinctly', () => {
    const overlap = ROOT_EVIDENCE_FIELDS.filter((field) =>
      (ROOT_METADATA_FIELDS as readonly string[]).includes(field),
    )

    expect(overlap).toEqual([])
  })

  it('treats the excerpt as evidence, because it is the evidence', () => {
    expect([...ROOT_EVIDENCE_FIELDS]).toContain('body')
  })

  it('leaves the title correctable, since it is a label rather than a record', () => {
    expect([...ROOT_METADATA_FIELDS]).toContain('title')
  })
})

// ticket 12: a whole-body edit surface has nowhere honest to send a Root's
// body, since the body is itself the evidence this module protects.
describe('whether a kind takes a whole-body edit', () => {
  it('refuses a Root', () => {
    expect(isBodyEditableKind('root')).toBe(false)
  })

  it('permits every other kind', () => {
    const others: readonly string[] = [
      'seed',
      'branch',
      'claim_leaf',
      'question_leaf',
      'idea_leaf',
      'observation_leaf',
      'harvest',
    ]

    for (const kind of others) {
      expect(isBodyEditableKind(kind as never)).toBe(true)
    }
  })
})
