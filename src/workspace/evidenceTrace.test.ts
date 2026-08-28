import { describe, expect, it } from 'vitest'
import { buildGardenIndex, type GardenIndex } from '../domain/index/gardenIndex'
import { isTracing, NOTHING_TRACED, traceEvidence } from './evidenceTrace'

const U = (n: string) => `01HQ8X2K3M4N5P6Q7R8S9T0${n}W`
const SEED = `seed_${U('S1')}`
const ROOT = `root_${U('R1')}`
const ROOT_2 = `root_${U('R2')}`
const BRANCH = `branch_${U('B1')}`
const CLAIM = `claim_leaf_${U('C1')}`
const CLAIM_2 = `claim_leaf_${U('C2')}`
const QUESTION = `question_leaf_${U('Q1')}`
const HARVEST = `harvest_${U('H1')}`

const front = (lines: string[]) =>
  [
    '---',
    'schema_version: 1',
    ...lines,
    'created_at: 2026-08-01T10:00:00Z',
    'updated_at: 2026-08-01T10:00:00Z',
    '---',
    '',
    'A body.',
    '',
  ].join('\n')

const branch = () => ({
  path: ['branches', 'b.md'],
  text: front([`id: ${BRANCH}`, 'kind: branch', 'title: Topic', 'state: active']),
})
const seed = () => ({
  path: ['seeds', 's.md'],
  text: front([`id: ${SEED}`, 'kind: seed', 'title: A capture']),
})
const root = (id = ROOT, title = 'Evidence') => ({
  path: ['roots', `${id}.md`],
  text: front([
    `id: ${id}`,
    'kind: root',
    `title: ${title}`,
    'captured_at: 2026-08-01T09:00:00Z',
    'content_hash: sha256:x',
  ]),
})
const claim = (id: string, title: string, supportedBy: string[], relations: string[] = []) => ({
  path: ['leaves', `${id}.md`],
  text: front([
    `id: ${id}`,
    'kind: claim_leaf',
    `title: ${title}`,
    `parent_id: ${BRANCH}`,
    'supported_by:',
    ...supportedBy.map((r) => `  - ${r}`),
    ...relations,
  ]),
})
const question = () => ({
  path: ['leaves', 'q.md'],
  text: front([`id: ${QUESTION}`, 'kind: question_leaf', 'title: A question', `parent_id: ${BRANCH}`]),
})
const HARVEST_BODY = [
  '## Question',
  'q',
  '## Synthesis',
  's',
  '## Evidence',
  'e',
  '## Contradictions and uncertainty',
  'c',
  '## Open questions',
  'o',
].join('\n\n')

const harvestFile = (supportedBy: string[], relations: string[] = []) => ({
  path: ['harvests', 'h.md'],
  text: [
    '---',
    'schema_version: 1',
    `id: ${HARVEST}`,
    'kind: harvest',
    'title: A synthesis',
    `parent_id: ${BRANCH}`,
    'supported_by:',
    ...supportedBy.map((r) => `  - ${r}`),
    ...relations,
    'created_at: 2026-08-01T10:00:00Z',
    'updated_at: 2026-08-01T10:00:00Z',
    '---',
    '',
    HARVEST_BODY,
    '',
  ].join('\n'),
})

async function indexOf(files: { path: string[]; text: string }[]): Promise<GardenIndex> {
  const index = await buildGardenIndex(files)
  if (index.diagnostics.length > 0) {
    throw new Error(`the fixture did not validate: ${JSON.stringify(index.diagnostics)}`)
  }
  return index
}

describe('tracing evidence for the selection', () => {
  it('traces nothing when nothing is selected', async () => {
    const index = await indexOf([branch(), root(), claim(CLAIM, 'A claim', [ROOT])])

    // The shared sentinel, not merely an equal-looking object -- so nothing
    // is allocated for the common case of no selection.
    expect(traceEvidence(index, undefined)).toBe(NOTHING_TRACED)
  })

  it('treats an id that is not in the Garden as nothing selected', async () => {
    const index = await indexOf([branch(), root(), claim(CLAIM, 'A claim', [ROOT])])

    expect(traceEvidence(index, 'claim_leaf_missing')).toBe(NOTHING_TRACED)
  })

  it('reaches the Root that directly supports a Claim', async () => {
    const index = await indexOf([branch(), root(), claim(CLAIM, 'A claim', [ROOT])])

    expect(traceEvidence(index, CLAIM).evidencePathIds.has(ROOT)).toBe(true)
  })

  // Ticket 09's second criterion, literally: a Harvest can rest on more than
  // one Root, and one traversal has to reach all of them.
  it('reaches every Root supporting a Harvest built from two', async () => {
    const index = await indexOf([
      branch(),
      root(ROOT, 'First'),
      root(ROOT_2, 'Second'),
      harvestFile([ROOT, ROOT_2]),
    ])

    const trace = traceEvidence(index, HARVEST)

    expect(trace.evidencePathIds.has(ROOT)).toBe(true)
    expect(trace.evidencePathIds.has(ROOT_2)).toBe(true)
  })

  // A Question has no Root pointing at it directly; the Harvest that answers
  // it is what carries the evidence. One traversal has to cross that hop too.
  it('reaches a Root through the Harvest that answers a Question, in one traversal', async () => {
    const index = await indexOf([
      branch(),
      root(),
      question(),
      harvestFile([ROOT], ['relations:', '  - type: answers', `    target: ${QUESTION}`]),
    ])

    const trace = traceEvidence(index, QUESTION)

    expect(trace.evidencePathIds.has(HARVEST)).toBe(true)
    expect(trace.evidencePathIds.has(ROOT)).toBe(true)
  })

  it('reaches the Seed a Claim was Derived From', async () => {
    const index = await indexOf([
      branch(),
      root(),
      seed(),
      claim(CLAIM, 'A claim', [ROOT], ['relations:', '  - type: derived_from', `    target: ${SEED}`]),
    ])

    expect(traceEvidence(index, CLAIM).evidencePathIds.has(SEED)).toBe(true)
  })

  it('records which relationship it walked', async () => {
    const index = await indexOf([branch(), root(), claim(CLAIM, 'A claim', [ROOT])])

    expect(traceEvidence(index, CLAIM).litEdges).toContain(`supports:${ROOT}->${CLAIM}`)
  })

  // A Root is where evidence terminates (ADR 0012): nothing supports it in
  // turn, so its own trace is empty rather than reaching what it supports.
  it('finds nothing upstream of a Root itself', async () => {
    const index = await indexOf([branch(), root(), claim(CLAIM, 'A claim', [ROOT])])

    expect(traceEvidence(index, ROOT).evidencePathIds.size).toBe(0)
  })

  // The bug a real-browser check caught: two Harvests citing the same Root
  // must not light each other up merely for sharing that citation. Tracing is
  // backward-only, so reaching a Root never continues on to whatever else it
  // supports.
  it('does not leak sideways through a Root shared with another supported item', async () => {
    const index = await indexOf([
      branch(),
      root(),
      claim(CLAIM, 'A claim', [ROOT]),
      harvestFile([ROOT]),
    ])

    expect(traceEvidence(index, CLAIM).evidencePathIds.has(HARVEST)).toBe(false)
  })

  it('finds nothing to trace for an item with no evidentiary relationship', async () => {
    const index = await indexOf([branch()])

    const trace = traceEvidence(index, BRANCH)

    expect(trace.evidencePathIds.size).toBe(0)
    expect(trace.contradictingIds.size).toBe(0)
    expect(trace.litEdges.size).toBe(0)
  })
})

describe('tracing a Contradicts relationship', () => {
  async function contradiction() {
    return indexOf([
      branch(),
      root(ROOT, 'For the first'),
      root(ROOT_2, 'For the second'),
      claim(CLAIM, 'Costs fall', [ROOT], [
        'relations:',
        '  - type: contradicts',
        `    target: ${CLAIM_2}`,
      ]),
      claim(CLAIM_2, 'Costs rise', [ROOT_2]),
    ])
  }

  it('names the Claim on the other side of a Contradicts relationship', async () => {
    const index = await contradiction()

    expect(traceEvidence(index, CLAIM).contradictingIds.has(CLAIM_2)).toBe(true)
  })

  it('finds the same Contradicts relationship from either side, since it is symmetric', async () => {
    const index = await contradiction()

    expect(traceEvidence(index, CLAIM_2).contradictingIds.has(CLAIM)).toBe(true)
  })

  // Disagreement is shown, not chased through the graph as if it were
  // evidence: the other Claim's own Root does not light up.
  it('does not treat a contradicting Claim’s own evidence as part of the path', async () => {
    const index = await contradiction()

    expect(traceEvidence(index, CLAIM).evidencePathIds.has(ROOT_2)).toBe(false)
  })

  it('does not put the contradicting Claim among the supporting items', async () => {
    const index = await contradiction()

    expect(traceEvidence(index, CLAIM).evidencePathIds.has(CLAIM_2)).toBe(false)
  })

  it('records the Contradicts relationship among the lit edges', async () => {
    const index = await contradiction()

    expect(traceEvidence(index, CLAIM).litEdges).toContain(`contradicts:${CLAIM}->${CLAIM_2}`)
  })
})

/**
 * A real-browser check found the consequence of getting this wrong directly:
 * selecting a Branch (which has no evidentiary relationship of its own) made
 * `tracing` true purely because something was selected, and every other node
 * in the Garden went dim -- a common, harmless action that read as broken.
 */
describe('whether a trace found anything to illuminate', () => {
  it('is false when nothing is selected', () => {
    expect(isTracing(NOTHING_TRACED)).toBe(false)
  })

  it('is false for a selection with no evidentiary relationship at all', async () => {
    const index = await indexOf([branch()])

    expect(isTracing(traceEvidence(index, BRANCH))).toBe(false)
  })

  // A Root is where evidence terminates (ADR 0012): selecting one directly
  // finds nothing upstream, and that must not be reported as "tracing".
  it('is false for a Root with nothing feeding into it', async () => {
    const index = await indexOf([branch(), root(), claim(CLAIM, 'A claim', [ROOT])])

    expect(isTracing(traceEvidence(index, ROOT))).toBe(false)
  })

  it('is true once a Root is reached', async () => {
    const index = await indexOf([branch(), root(), claim(CLAIM, 'A claim', [ROOT])])

    expect(isTracing(traceEvidence(index, CLAIM))).toBe(true)
  })

  it('is true from a Contradicts relationship', async () => {
    const index = await contradiction()

    expect(isTracing(traceEvidence(index, CLAIM))).toBe(true)
  })
})

/** Reused from the describe block above -- same shape, same two Claims. */
async function contradiction() {
  return indexOf([
    branch(),
    root(ROOT, 'For the first'),
    root(ROOT_2, 'For the second'),
    claim(CLAIM, 'Costs fall', [ROOT], [
      'relations:',
      '  - type: contradicts',
      `    target: ${CLAIM_2}`,
    ]),
    claim(CLAIM_2, 'Costs rise', [ROOT_2]),
  ])
}
