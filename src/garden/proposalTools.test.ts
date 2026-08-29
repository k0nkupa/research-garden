import { describe, expect, it } from 'vitest'
import { buildGardenIndex } from '../domain/index/gardenIndex'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { readPendingChange } from './pendingChange'
import { approveChange } from './approveChange'
import { proposeHarvest, proposeMove, proposeRelation } from './proposalTools'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B1W'
const BRANCH_2 = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0B2W'
const ROOT = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R1W'
const ROOT_2 = 'root_01HQ8X2K3M4N5P6Q7R8S9T0R2W'
const QUESTION = 'question_leaf_01HQ8X2K3M4N5P6Q7R8S9T0Q1W'
const CLAIM = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C1W'
const CLAIM_2 = 'claim_leaf_01HQ8X2K3M4N5P6Q7R8S9T0C2W'
const NOW = '2026-08-29T01:00:00Z'

const front = (fields: string[], body = 'Body.') => `---\nschema_version: 1\n${fields.join('\n')}\ncreated_at: ${NOW}\nupdated_at: ${NOW}\n---\n\n${body}\n`
const files = {
  'branches/a.md': front([`id: ${BRANCH}`, 'kind: branch', 'title: A', 'state: active']),
  'branches/b.md': front([`id: ${BRANCH_2}`, 'kind: branch', 'title: B', 'state: active']),
  'roots/r.md': front([`id: ${ROOT}`, 'kind: root', 'title: Evidence', 'captured_at: 2026-08-28T00:00:00Z', 'content_hash: sha256:abc']),
  'roots/r2.md': front([`id: ${ROOT_2}`, 'kind: root', 'title: Evidence 2', 'captured_at: 2026-08-28T00:00:00Z', 'content_hash: sha256:def']),
  'leaves/q.md': front([`id: ${QUESTION}`, 'kind: question_leaf', 'title: Open question', `parent_id: ${BRANCH}`]),
  'leaves/c.md': front([`id: ${CLAIM}`, 'kind: claim_leaf', 'title: Claim', `parent_id: ${BRANCH}`, `supported_by:\n  - ${ROOT}`]),
  'leaves/c2.md': front([`id: ${CLAIM_2}`, 'kind: claim_leaf', 'title: Contrary claim', `parent_id: ${BRANCH}`, `supported_by:\n  - ${ROOT_2}`, 'relations:', '  - type: contradicts', `    target: ${CLAIM}`]),
}

async function setup() {
  const fileSystem = new InMemoryGardenFileSystem(files, 'garden')
  const index = await buildGardenIndex(Object.entries(files).map(([path, text]) => ({ path: path.split('/'), text })))
  return { fileSystem, index }
}

const options = { now: () => NOW }

describe('proposal action seam', () => {
  it('stages one relationship in the source file and never writes canonical content', async () => {
    const { fileSystem, index } = await setup()
    const before = fileSystem.snapshot()['branches/a.md']
    const result = await proposeRelation(fileSystem, { sourceId: BRANCH, targetId: BRANCH_2, type: 'relates_to' }, options)
    expect(result.kind).toBe('proposed')
    expect(fileSystem.snapshot()['branches/a.md']).toBe(before)
    if (result.kind !== 'proposed') return
    const record = await readPendingChange(fileSystem, result.id)
    expect(record?.path).toEqual(['branches', 'a.md'])
    expect(record?.baseState).toBe('present')
    expect(record?.previewText).toContain(`target: ${BRANCH_2}`)
    expect(record?.previewHash).toBe(result.previewHash)
  })

  it('stages a move with one exact-file preview and refuses an invalid relation', async () => {
    const { fileSystem, index } = await setup()
    const result = await proposeMove(fileSystem, { itemId: CLAIM, parentId: BRANCH_2 }, options)
    expect(result.kind).toBe('proposed')
    if (result.kind === 'proposed') expect((await readPendingChange(fileSystem, result.id))?.previewText).toContain(`parent_id: ${BRANCH_2}`)
    const refused = await proposeRelation(fileSystem, { sourceId: ROOT, targetId: QUESTION, type: 'answers' }, options)
    expect(refused).toMatchObject({ kind: 'invalid', code: 'relation' })
  })

  it('stores a proposed Supports relationship on the Claim file', async () => {
    const { fileSystem, index } = await setup()
    const result = await proposeRelation(fileSystem, { sourceId: ROOT_2, targetId: CLAIM, type: 'supports' }, options)
    expect(result.kind).toBe('proposed')
    if (result.kind === 'proposed') {
      const record = await readPendingChange(fileSystem, result.id)
      expect(record?.path).toEqual(['leaves', 'c.md'])
      expect(record?.previewText).toContain(`- ${ROOT_2}`)
    }
  })

  it('stages an evidence-shaped Harvest with an Answers relationship', async () => {
    const { fileSystem, index } = await setup()
    const result = await proposeHarvest(fileSystem, {
      title: 'A synthesis', parentId: BRANCH, supportedBy: [ROOT], questionId: QUESTION,
      question: 'What is happening?', synthesis: 'The evidence supports this synthesis.', evidence: 'Evidence is cited.', contradictionsAndUncertainty: 'The claims may disagree; uncertainty is preserved.', openQuestions: 'What remains to test?',
    }, options)
    expect(result.kind).toBe('proposed')
    if (result.kind !== 'proposed') return
    expect(fileSystem.snapshot()['harvests/a-synthesis.md']).toBeUndefined()
    const record = await readPendingChange(fileSystem, result.id)
    expect(record?.path[0]).toBe('harvests')
    expect(record?.baseText).toBe('')
    expect(record?.baseState).toBe('absent')
    expect(record?.previewText).toContain('type: answers')
    expect(record?.previewText).toContain('## Contradictions and uncertainty')
  })

  it('requires explicit contradictory Claim identities and preserves both in the preview', async () => {
    const { fileSystem } = await setup()
    const result = await proposeHarvest(fileSystem, {
      title: 'Contradiction synthesis', parentId: BRANCH, supportedBy: [ROOT], claimIds: [CLAIM, CLAIM_2],
      contradictionsAndUncertainty: 'The evidence conflicts and the uncertainty remains unresolved.',
      question: 'Question', synthesis: 'Synthesis', evidence: 'Evidence', openQuestions: 'Open',
    }, options)
    if (result.kind !== 'proposed') console.log('contradiction proposal', result)
    expect(result.kind).toBe('proposed')
    if (result.kind === 'proposed') {
      const record = await readPendingChange(fileSystem, result.id)
      expect(record?.previewText).toContain(`Claims considered: ${CLAIM}, ${CLAIM_2}`)
      expect(record?.previewText).toContain('Contradictions and uncertainty')
    }
  })

  it('rejects a Harvest that names Claims without a Contradicts edge or meaningful uncertainty', async () => {
    const { fileSystem } = await setup()
    const noEdge = await proposeHarvest(fileSystem, {
      title: 'Invalid synthesis', parentId: BRANCH, supportedBy: [ROOT], claimIds: [CLAIM, QUESTION],
      question: 'Question', synthesis: 'Synthesis', evidence: 'Evidence', contradictionsAndUncertainty: 'Uncertainty', openQuestions: 'Open',
    }, options)
    expect(noEdge).toMatchObject({ kind: 'invalid', code: 'relation' })
    const empty = await proposeHarvest(fileSystem, {
      title: 'Empty uncertainty', parentId: BRANCH, supportedBy: [ROOT], claimIds: [CLAIM, CLAIM_2],
      question: 'Question', synthesis: 'Synthesis', evidence: 'Evidence', contradictionsAndUncertainty: '   ', openQuestions: 'Open',
    }, options)
    expect(empty).toMatchObject({ kind: 'invalid', code: 'schema' })
  })

  it('lets the existing approval seam materialize the new Harvest file', async () => {
    const { fileSystem, index } = await setup()
    const proposed = await proposeHarvest(fileSystem, {
      title: 'A synthesis', parentId: BRANCH, supportedBy: [ROOT],
      question: 'Question', synthesis: 'Synthesis', evidence: 'Evidence', contradictionsAndUncertainty: 'Uncertainty is retained.', openQuestions: 'Open',
    }, options)
    if (proposed.kind !== 'proposed') throw new Error(`expected proposal, got ${proposed.kind}`)
    const result = await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)
    expect(result.kind).toBe('applied')
    expect(Object.keys(fileSystem.snapshot()).some((path) => path.startsWith('harvests/'))).toBe(true)
  })

  it('refuses approval when an empty file wins the absent-target race', async () => {
    const { fileSystem } = await setup()
    const proposed = await proposeHarvest(fileSystem, {
      title: 'Raced Harvest', parentId: BRANCH, supportedBy: [ROOT],
      question: 'Question', synthesis: 'Synthesis', evidence: 'Evidence', contradictionsAndUncertainty: 'Uncertainty is retained.', openQuestions: 'Open',
    }, options)
    if (proposed.kind !== 'proposed') throw new Error(`expected proposal, got ${proposed.kind}`)
    const record = await readPendingChange(fileSystem, proposed.id)
    if (!record) throw new Error('expected pending record')
    await fileSystem.write(record.path, '')
    const result = await approveChange(fileSystem, { id: proposed.id, previewHash: proposed.previewHash }, options)
    expect(result).toMatchObject({ kind: 'stale' })
    expect(fileSystem.snapshot()[record.path.join('/')]).toBe('')
  })
})
