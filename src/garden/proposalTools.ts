import { z } from 'zod'
import { contentHash } from '../domain/hash'
import { buildGardenIndex, type GardenIndex, type ScannedFile } from '../domain/index/gardenIndex'
import { parseGardenDocument, serializeGardenDocument, serializeNewGardenDocument, setFrontmatterField, type GardenDocument } from '../domain/document/gardenDocument'
import { nowAsCanonicalTimestamp } from '../domain/schema/canonicalTimestamp'
import { CANONICAL_FIELD_ORDER, REQUIRED_HARVEST_SECTIONS } from '../domain/schema/gardenItem'
import { directoryForKind, fileNameFor } from '../domain/schema/itemIdentity'
import { isPermittedPairing } from '../domain/schema/relations'
import { createItemIdFactory, browserEntropy, createUlidFactory, type UlidEntropy } from '../domain/schema/ulid'
import { GardenFileSystemError, type GardenFileSystem, type GardenPath } from '../filesystem/GardenFileSystem'
import { ensureMutable } from './mutationGuard'
import { diagnosticMessageForItem } from './diagnosticMessage'
import { scanCanonicalFiles } from './openGarden'
import { writePendingChange, type PendingChangeRecord } from './pendingChange'

export const proposeRelationInputSchema = z.strictObject({
  sourceId: z.string().min(1),
  targetId: z.string().min(1),
  // Parent is represented by `parent_id` and therefore has its dedicated
  // propose_move action; Supports is represented by `supported_by` but still
  // belongs on this general relationship seam.
  type: z.enum(['derived_from', 'supports', 'answers', 'contradicts', 'relates_to']),
})
export type ProposeRelationInput = z.infer<typeof proposeRelationInputSchema>

export const proposeMoveInputSchema = z.strictObject({
  itemId: z.string().min(1),
  parentId: z.string().min(1),
})
export type ProposeMoveInput = z.infer<typeof proposeMoveInputSchema>

export const proposeHarvestInputSchema = z
  .strictObject({
    title: z.string().trim().min(1),
    parentId: z.string().min(1),
    supportedBy: z.array(z.string().min(1)).min(1),
    /** Exactly the two Claims being synthesized when the Harvest addresses a contradiction. */
    claimIds: z.array(z.string().min(1)).length(2).optional(),
    questionId: z.string().min(1).optional(),
    body: z.string().optional(),
    question: z.string().optional(),
    synthesis: z.string().optional(),
    evidence: z.string().optional(),
    contradictionsAndUncertainty: z.string().optional(),
    openQuestions: z.string().optional(),
  })
  .superRefine((input, context) => {
    if (input.body !== undefined) return
    const missing = REQUIRED_HARVEST_SECTIONS.filter((section) => {
      const field = section === 'Question' ? input.question
        : section === 'Synthesis' ? input.synthesis
          : section === 'Evidence' ? input.evidence
              : section === 'Contradictions and uncertainty' ? input.contradictionsAndUncertainty
              : input.openQuestions
      return field === undefined
    })
    if (missing.length > 0) {
      context.addIssue({ code: 'custom', message: `provide every Harvest section: ${missing.join(', ')}`, path: ['body'] })
    }
  })
export type ProposeHarvestInput = z.infer<typeof proposeHarvestInputSchema>

export interface ProposalOptions {
  readonly now?: (() => string) | undefined
  readonly entropy?: UlidEntropy | undefined
}

export type ProposalResult =
  | { readonly kind: 'proposed'; readonly id: string; readonly itemId: string; readonly path: GardenPath; readonly previewHash: string; readonly gardenRevision: string }
  | { readonly kind: 'invalid'; readonly code: 'lookup' | 'schema' | 'relation'; readonly message: string }
  | { readonly kind: 'blocked'; readonly message: string }
  | { readonly kind: 'permission-required' }
  | { readonly kind: 'failed'; readonly message: string }

const FAILURE = 'The proposal could not be recorded. Check that the Garden Repository is still available and try again.'

type ProposalRecordPayload = {
  readonly baseState: 'present'
  readonly itemId: string
  readonly path: GardenPath
  readonly baseText: string
  readonly previewText: string
  readonly proposedAt: string
} | {
  readonly baseState: 'absent'
  readonly itemId: string
  readonly path: GardenPath
  readonly baseText: ''
  readonly previewText: string
  readonly proposedAt: string
}

async function currentGarden(fileSystem: GardenFileSystem): Promise<{ readonly files: ScannedFile[]; readonly index: GardenIndex }> {
  const files = await scanCanonicalFiles(fileSystem)
  return { files, index: await buildGardenIndex(files) }
}

function failure(error: unknown): ProposalResult {
  if (error instanceof GardenFileSystemError && error.code === 'permission-denied') return { kind: 'permission-required' }
  return { kind: 'failed', message: FAILURE }
}

function relationAlreadyExists(index: GardenIndex, input: ProposeRelationInput): boolean {
  return index.graph.relationships.some((relation) => {
    if (relation.type !== input.type) return false
    if (relation.sourceId === input.sourceId && relation.targetId === input.targetId) return true
    return (input.type === 'contradicts' || input.type === 'relates_to') && relation.sourceId === input.targetId && relation.targetId === input.sourceId
  })
}

function hasContradiction(index: GardenIndex, firstId: string, secondId: string): boolean {
  return index.graph.relationships.some((relation) => relation.type === 'contradicts' && (
    (relation.sourceId === firstId && relation.targetId === secondId) ||
    (relation.sourceId === secondId && relation.targetId === firstId)
  ))
}

async function recordProposal(
  fileSystem: GardenFileSystem,
  index: GardenIndex,
  payload: ProposalRecordPayload,
  entropy: UlidEntropy | undefined,
): Promise<ProposalResult> {
  const previewHash = await contentHash(payload.previewText)
  const id = createUlidFactory(entropy ?? browserEntropy)()
  const record: PendingChangeRecord = {
    id, ...payload, baseHash: await contentHash(payload.baseText), previewHash,
  }
  try {
    await writePendingChange(fileSystem, record)
  } catch (error) {
    return failure(error)
  }
  return { kind: 'proposed', id, itemId: payload.itemId, path: payload.path, previewHash, gardenRevision: index.revision }
}

async function replaceItemFrontmatter(
  fileSystem: GardenFileSystem,
  index: GardenIndex,
  itemId: string,
  mutate: (document: GardenDocument) => GardenDocument,
  options: ProposalOptions,
): Promise<ProposalResult> {
  const indexed = index.items.get(itemId)
  if (!indexed) return { kind: 'invalid', code: 'lookup', message: `Item ${itemId} was not found in this Garden.` }
  const block = ensureMutable(index, itemId)
  if (block) return { kind: 'blocked', message: block.reason }
  try {
    const baseText = await fileSystem.read(indexed.path)
    const parsed = parseGardenDocument(baseText)
    if (!parsed.ok) return { kind: 'invalid', code: 'schema', message: 'The proposal target could not be parsed.' }
    const previewText = serializeGardenDocument(mutate(parsed.document))
    const candidate = await buildGardenIndex((await scanCanonicalFiles(fileSystem)).map((file) => file.path.join('/') === indexed.path.join('/') ? { path: file.path, text: previewText } : file))
    const problem = diagnosticMessageForItem(candidate, itemId)
    if (!candidate.items.has(itemId) || problem) return { kind: 'invalid', code: 'schema', message: `The proposal would leave the item invalid${problem ? `: ${problem}` : '.'}` }
    return recordProposal(fileSystem, index, { itemId, path: indexed.path, baseText, previewText, proposedAt: (options.now ?? nowAsCanonicalTimestamp)(), baseState: 'present' }, options.entropy)
  } catch (error) {
    return failure(error)
  }
}

export async function proposeRelation(fileSystem: GardenFileSystem, input: ProposeRelationInput, options: ProposalOptions = {}): Promise<ProposalResult> {
  const parsed = proposeRelationInputSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid', code: 'schema', message: 'Invalid relation proposal input.' }
  try {
    if ((await fileSystem.permission()) !== 'granted') return { kind: 'permission-required' }
    const { index } = await currentGarden(fileSystem)
    const source = index.items.get(input.sourceId)
    const target = index.items.get(input.targetId)
    if (!source || !target) return { kind: 'invalid', code: 'lookup', message: 'Both relationship items must exist in this Garden.' }
    if (!isPermittedPairing(input.type, source.item.kind, target.item.kind)) return { kind: 'invalid', code: 'relation', message: `A ${input.type} relationship cannot join these item kinds.` }
    if (input.sourceId === input.targetId || relationAlreadyExists(index, input)) return { kind: 'invalid', code: 'relation', message: 'That relationship already exists or points at itself.' }
    const sourceBlock = ensureMutable(index, input.sourceId)
    if (sourceBlock) return { kind: 'blocked', message: sourceBlock.reason }
    const declaredOn = input.type === 'supports' ? input.targetId : input.sourceId
    return replaceItemFrontmatter(fileSystem, index, declaredOn, (document) => {
      if (input.type === 'supports') {
        const supportedBy = Array.isArray(document.frontmatter.supported_by) ? [...document.frontmatter.supported_by, input.sourceId] : [input.sourceId]
        return setFrontmatterField(document, 'supported_by', supportedBy)
      }
      const relations = Array.isArray(document.frontmatter.relations) ? [...document.frontmatter.relations, { type: input.type, target: input.targetId }] : [{ type: input.type, target: input.targetId }]
      return setFrontmatterField(document, 'relations', relations)
    }, options)
  } catch (error) { return failure(error) }
}

export async function proposeMove(fileSystem: GardenFileSystem, input: ProposeMoveInput, options: ProposalOptions = {}): Promise<ProposalResult> {
  const parsed = proposeMoveInputSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid', code: 'schema', message: 'Invalid move proposal input.' }
  try {
    if ((await fileSystem.permission()) !== 'granted') return { kind: 'permission-required' }
    const { index } = await currentGarden(fileSystem)
    const item = index.items.get(input.itemId)
    const parent = index.items.get(input.parentId)
    if (!item || !parent) return { kind: 'invalid', code: 'lookup', message: 'The moved item and new Branch parent must exist in this Garden.' }
    if (parent.item.kind !== 'branch') return { kind: 'invalid', code: 'relation', message: 'An item can only be moved under a Branch.' }
    if (item.item.parentId === input.parentId) return { kind: 'invalid', code: 'relation', message: 'The item is already under that Branch.' }
    const parentBlock = ensureMutable(index, input.parentId)
    if (parentBlock) return { kind: 'blocked', message: parentBlock.reason }
    return replaceItemFrontmatter(fileSystem, index, input.itemId, (document) => setFrontmatterField(document, 'parent_id', input.parentId), options)
  } catch (error) { return failure(error) }
}

function harvestBody(input: ProposeHarvestInput): string {
  if (input.body !== undefined) return input.body
  return [
    ['Question', input.question], ['Synthesis', input.synthesis], ['Evidence', input.evidence],
    ['Contradictions and uncertainty', input.contradictionsAndUncertainty], ['Open questions', input.openQuestions],
  ].map(([heading, body]) => `## ${heading}\n\n${body ?? ''}`).join('\n\n') + '\n'
}

function uncertaintyText(body: string): string {
  const headings = [...body.matchAll(/^\s{0,3}#{1,6}\s+(.+?)\s*$/gm)]
  const heading = headings.find((match) => (match[1] ?? '').trim().toLowerCase() === 'contradictions and uncertainty')
  if (!heading || heading.index === undefined) return ''
  const start = heading.index + heading[0].length
  const nextHeading = headings.find((match) => match.index !== undefined && match.index > heading.index!)
  return body.slice(start, nextHeading?.index ?? body.length).trim()
}

export async function proposeHarvest(fileSystem: GardenFileSystem, input: ProposeHarvestInput, options: ProposalOptions = {}): Promise<ProposalResult> {
  const parsed = proposeHarvestInputSchema.safeParse(input)
  if (!parsed.success) return { kind: 'invalid', code: 'schema', message: 'Invalid Harvest proposal input.' }
  try {
    if ((await fileSystem.permission()) !== 'granted') return { kind: 'permission-required' }
    const current = await currentGarden(fileSystem)
    const parent = current.index.items.get(input.parentId)
    if (!parent) return { kind: 'invalid', code: 'lookup', message: `Branch ${input.parentId} was not found in this Garden.` }
    if (parent.item.kind !== 'branch') return { kind: 'invalid', code: 'relation', message: 'A Harvest must be placed under a Branch.' }
    const parentBlock = ensureMutable(current.index, input.parentId)
    if (parentBlock) return { kind: 'blocked', message: parentBlock.reason }
    for (const rootId of input.supportedBy) {
      const root = current.index.items.get(rootId)
      if (!root) return { kind: 'invalid', code: 'lookup', message: `Root ${rootId} was not found in this Garden.` }
      if (root.item.kind !== 'root') return { kind: 'invalid', code: 'relation', message: 'A Harvest can only cite Root evidence.' }
      const block = ensureMutable(current.index, rootId)
      if (block) return { kind: 'blocked', message: block.reason }
    }
    for (const claimId of input.claimIds ?? []) {
      const claim = current.index.items.get(claimId)
      if (!claim) return { kind: 'invalid', code: 'lookup', message: `Claim Leaf ${claimId} was not found in this Garden.` }
      if (claim.item.kind !== 'claim_leaf') return { kind: 'invalid', code: 'relation', message: 'A Harvest contradiction must name Claim Leaves.' }
    }
    const questionId = input.questionId
    if (questionId !== undefined) {
      const question = current.index.items.get(questionId)
      if (!question) return { kind: 'invalid', code: 'lookup', message: `Question Leaf ${questionId} was not found in this Garden.` }
      if (question.item.kind !== 'question_leaf') return { kind: 'invalid', code: 'relation', message: 'Answers must target a Question Leaf.' }
    }
    const now = (options.now ?? nowAsCanonicalTimestamp)()
    const id = createItemIdFactory(options.entropy ?? browserEntropy)('harvest')
    let contradictionClaims: readonly [string, string] | undefined
    if (input.claimIds !== undefined) {
      if (new Set(input.claimIds).size !== 2) return { kind: 'invalid', code: 'relation', message: 'A contradictory Harvest must identify two distinct Claim Leaves.' }
      const [firstClaim, secondClaim] = input.claimIds
      if (!firstClaim || !secondClaim) return { kind: 'invalid', code: 'relation', message: 'A contradictory Harvest must identify two distinct Claim Leaves.' }
      if (!hasContradiction(current.index, firstClaim, secondClaim)) return { kind: 'invalid', code: 'relation', message: 'The identified Claim Leaves are not joined by a Contradicts relationship.' }
      contradictionClaims = [firstClaim, secondClaim]
    }
    const relations = questionId === undefined ? [] : [{ type: 'answers', target: questionId }]
    const path: GardenPath = [directoryForKind('harvest'), fileNameFor({ id, kind: 'harvest', title: input.title }, new Set(current.files.filter((file) => file.path[0] === 'harvests').map((file) => file.path.at(-1) as string)))]
    const rawBody = harvestBody(input)
    const uncertainty = uncertaintyText(rawBody)
    if (input.claimIds !== undefined && uncertainty.length === 0) return { kind: 'invalid', code: 'schema', message: 'A contradictory Harvest must explain the uncertainty in its Contradictions and uncertainty section.' }
    const body = contradictionClaims === undefined ? rawBody : rawBody.replace(
      /(^\s{0,3}#{1,6}\s+Contradictions and uncertainty\s*$)/im,
      `$1\n\nClaims considered: ${contradictionClaims.join(', ')}\nContradicts relationship preserved between: ${contradictionClaims[0]} and ${contradictionClaims[1]}`,
    )
    const previewText = serializeNewGardenDocument({ schema_version: 1, id, kind: 'harvest', title: input.title, supported_by: input.supportedBy, parent_id: input.parentId, relations, created_at: now, updated_at: now }, body, CANONICAL_FIELD_ORDER)
    const candidate = await buildGardenIndex([...current.files, { path, text: previewText }])
    const problem = diagnosticMessageForItem(candidate, id)
    if (!candidate.items.has(id) || problem) return { kind: 'invalid', code: 'schema', message: `The Harvest proposal is invalid${problem ? `: ${problem}` : '.'}` }
    return recordProposal(fileSystem, current.index, { itemId: id, path, baseText: '', previewText, proposedAt: now, baseState: 'absent' }, options.entropy)
  } catch (error) { return failure(error) }
}
