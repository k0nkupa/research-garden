import { z } from 'zod'
import { contentHash } from '../domain/hash'
import { buildGardenIndex, type GardenIndex } from '../domain/index/gardenIndex'
import { serializeNewGardenDocument } from '../domain/document/gardenDocument'
import { nowAsCanonicalTimestamp } from '../domain/schema/canonicalTimestamp'
import {
  CANONICAL_FIELD_ORDER,
  type GardenItem,
} from '../domain/schema/gardenItem'
import {
  directoryForKind,
  fileNameFor,
  type GardenItemKind as ItemKind,
} from '../domain/schema/itemIdentity'
import { createItemIdFactory, createUlidFactory, browserEntropy, type UlidEntropy } from '../domain/schema/ulid'
import { GardenFileSystemError, type GardenFileSystem, type GardenPath } from '../filesystem/GardenFileSystem'
import { scanCanonicalFiles } from './openGarden'
import { ensureMutable } from './mutationGuard'
import { writeUndoSnapshot } from './undoSnapshot'
import { writeAndVerify } from './verifiedWrite'

/** Inputs shared by the three low-risk, one-file addition actions. */
export const plantSeedInputSchema = z.strictObject({
  title: z.string().trim().min(1),
  body: z.string(),
})
export type PlantSeedInput = z.infer<typeof plantSeedInputSchema>

export const captureRootInputSchema = z
  .strictObject({
    title: z.string().trim().min(1),
    originUrl: z.string().refine((value) => /^https?:\/\//i.test(value), 'must be an http or https URL'),
    /** `content` is the preferred name; `excerpt` is accepted for WebMCP callers using the domain term. */
    content: z.string().optional(),
    excerpt: z.string().optional(),
    attribution: z.string().optional(),
  })
  .refine((input) => input.content !== undefined || input.excerpt !== undefined, {
    message: 'provide the exact captured content or excerpt',
    path: ['content'],
  })
export type CaptureRootInput = z.infer<typeof captureRootInputSchema>

export const addLeafInputSchema = z.strictObject({
  title: z.string().trim().min(1),
  body: z.string(),
  kind: z.enum(['claim_leaf', 'question_leaf', 'idea_leaf', 'observation_leaf']),
  parentId: z.string().min(1),
  supportedBy: z.array(z.string().min(1)).optional(),
})
export type AddLeafInput = z.infer<typeof addLeafInputSchema>

export interface DirectAdditionOptions {
  readonly now?: (() => string) | undefined
  readonly entropy?: UlidEntropy | undefined
}

export interface DirectAdditionCreated {
  readonly kind: 'created'
  readonly item: GardenItem
  readonly path: GardenPath
  readonly snapshotId: string
  readonly resultingHash: string
  readonly gardenRevision: string
}

export type DirectAdditionResult =
  | DirectAdditionCreated
  | { readonly kind: 'blocked'; readonly reason: string }
  | { readonly kind: 'invalid'; readonly message: string; readonly code?: 'schema' | 'relation' }
  | { readonly kind: 'permission-required' }
  | { readonly kind: 'verification-failed'; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string }

const GENERIC_FAILURE_MESSAGE =
  'The addition could not be completed. Check that the Garden Repository is still available and try again.'

/** A short diagnostic summary suitable for a structured tool error. */
function invalidItemMessage(index: GardenIndex, itemId: string): string | undefined {
  const diagnostic = index.diagnostics.find((entry) => entry.itemId === itemId)
  if (!diagnostic) return undefined
  return diagnostic.problems.map((problem) => `${problem.field} ${problem.message}`).join('; ')
}

async function freshIndex(fileSystem: GardenFileSystem): Promise<{ index: GardenIndex; files: Awaited<ReturnType<typeof scanCanonicalFiles>> }> {
  const files = await scanCanonicalFiles(fileSystem)
  return { files, index: await buildGardenIndex(files) }
}

function takenNames(
  index: GardenIndex,
  kind: ItemKind,
  scanned: readonly { readonly path: GardenPath }[] = [],
): ReadonlySet<string> {
  const directory = directoryForKind(kind)
  const fromIndex = [...index.items.values()]
    .filter((indexed) => indexed.path[0] === directory)
    .map((indexed) => indexed.path.at(-1) as string)
  const fromDisk = scanned
    .filter((file) => file.path[0] === directory)
    .map((file) => file.path.at(-1) as string)
  return new Set(
    [...fromIndex, ...fromDisk],
  )
}

function planAdditionDocument(item: {
  readonly id: string
  readonly kind: ItemKind
  readonly title: string
  readonly extra?: Record<string, unknown>
  readonly body: string
}, index: GardenIndex, scanned: readonly { readonly path: GardenPath }[] = []) {
  const frontmatter: Record<string, unknown> = {
    schema_version: 1,
    id: item.id,
    kind: item.kind,
    title: item.title,
    ...(item.extra ?? {}),
  }
  const path: GardenPath = [
    directoryForKind(item.kind),
    fileNameFor({ id: item.id, kind: item.kind, title: item.title }, takenNames(index, item.kind, scanned)),
  ]
  return { path, text: serializeNewGardenDocument(frontmatter, item.body, CANONICAL_FIELD_ORDER) }
}

function generatedId(index: GardenIndex, kind: ItemKind, entropy: UlidEntropy): string | undefined {
  const id = createItemIdFactory(entropy)(kind)
  return index.items.has(id) ? undefined : id
}

/**
 * Applies one new canonical file and records the Undo Snapshot that describes
 * the empty state it replaced. Additions do not mutate a prior canonical file,
 * so the snapshot's previous text is empty; the canonical write remains one
 * write and the snapshot remains a recoverable operational record.
 */
async function applyAddition(
  fileSystem: GardenFileSystem,
  current: { readonly index: GardenIndex; readonly files: Awaited<ReturnType<typeof scanCanonicalFiles>> },
  draft: { readonly id: string; readonly kind: ItemKind; readonly title: string; readonly extra?: Record<string, unknown>; readonly body: string },
  appliedAt: string,
  options: DirectAdditionOptions,
): Promise<DirectAdditionResult> {
  const planned = planAdditionDocument(draft, current.index, current.files)
  const candidate = await buildGardenIndex([...current.files, planned])
  const candidateItem = candidate.items.get(draft.id)

  if (!candidateItem) {
    return { kind: 'invalid', message: 'The new item did not pass Garden schema and graph validation.' }
  }
  const candidateProblem = invalidItemMessage(candidate, draft.id)
  if (candidateProblem) {
    return { kind: 'invalid', message: `The new item is invalid: ${candidateProblem}` }
  }

  // A second tab can create the same title between the scan above and this
  // write. Never let a direct addition overwrite that newly-created file.
  try {
    await fileSystem.read(planned.path)
    return { kind: 'failed', message: 'A file with that name appeared while the addition was being prepared. Try again.' }
  } catch (error) {
    if (!(error instanceof GardenFileSystemError) || error.code !== 'not-found') {
      return filesystemFailure(error)
    }
  }

  const snapshotId = createUlidFactory(options.entropy ?? browserEntropy)()
  const previousHash = await contentHash('')
  await writeUndoSnapshot(fileSystem, {
    id: snapshotId,
    itemId: draft.id,
    path: planned.path,
    previousState: 'absent',
    previousText: '',
    previousHash,
    resultingHash: await contentHash(planned.text),
    appliedAt,
  })

  const verified = await writeAndVerify(fileSystem, planned.path, planned.text)
  if (verified.kind === 'verification-failed') return verified

  const after = await freshIndex(fileSystem)
  const afterItem = after.index.items.get(draft.id)
  const afterProblem = invalidItemMessage(after.index, draft.id)
  if (!afterItem || afterProblem) {
    return {
      kind: 'verification-failed',
      message: 'The new item was written but did not pass the final Garden validation.',
    }
  }

  return {
    kind: 'created',
    item: afterItem.item,
    path: planned.path,
    snapshotId,
    resultingHash: verified.hash,
    gardenRevision: after.index.revision,
  }
}

function validateInput<T>(schema: z.ZodType<T>, input: T): DirectAdditionResult | undefined {
  const parsed = schema.safeParse(input)
  if (parsed.success) return undefined
  const first = parsed.error.issues[0]
  return {
    kind: 'invalid',
    message: first
      ? `Invalid addition input at ${first.path.join('.') || 'input'}: ${first.message}`
      : 'Invalid addition input.',
  }
}

export async function plantSeed(
  fileSystem: GardenFileSystem,
  input: PlantSeedInput,
  options: DirectAdditionOptions = {},
): Promise<DirectAdditionResult> {
  const invalid = validateInput(plantSeedInputSchema, input)
  if (invalid) return invalid

  return runAddition(fileSystem, 'seed', input.title, input.body, {}, options)
}

export async function captureRoot(
  fileSystem: GardenFileSystem,
  input: CaptureRootInput,
  options: DirectAdditionOptions = {},
): Promise<DirectAdditionResult> {
  const invalid = validateInput(captureRootInputSchema, input)
  if (invalid) return invalid

  const content = input.content ?? input.excerpt ?? ''
  const capturedAt = (options.now ?? nowAsCanonicalTimestamp)()
  return runAddition(
    fileSystem,
    'root',
    input.title,
    content,
    {
      origin_url: input.originUrl,
      captured_at: capturedAt,
      content_hash: await contentHash(content),
      ...(input.attribution !== undefined ? { attribution: input.attribution } : {}),
    },
    options,
    capturedAt,
  )
}

export async function addLeaf(
  fileSystem: GardenFileSystem,
  input: AddLeafInput,
  options: DirectAdditionOptions = {},
): Promise<DirectAdditionResult> {
  const invalid = validateInput(addLeafInputSchema, input)
  if (invalid) return invalid

  let current: Awaited<ReturnType<typeof freshIndex>>
  try {
    if ((await fileSystem.permission()) !== 'granted') return { kind: 'permission-required' }
    current = await freshIndex(fileSystem)
  } catch (error) {
    return filesystemFailure(error)
  }

  const parentBlock = ensureMutable(current.index, input.parentId)
  if (parentBlock) return { kind: 'blocked', reason: parentBlock.reason }
  const parent = current.index.items.get(input.parentId)
  if (!parent || parent.item.kind !== 'branch') {
    return { kind: 'invalid', code: 'relation', message: 'A Leaf must name an existing Branch as its parent.' }
  }

  const supportedBy = input.supportedBy ?? []
  if (input.kind === 'claim_leaf' && supportedBy.length === 0) {
    return { kind: 'invalid', message: 'A Claim Leaf must cite at least one supporting Root.' }
  }
  for (const rootId of supportedBy) {
    const root = current.index.items.get(rootId)
    if (!root || root.item.kind !== 'root') {
      return { kind: 'invalid', code: 'relation', message: `${rootId} is not an existing Root that can support this Leaf.` }
    }
    const rootBlock = ensureMutable(current.index, rootId)
    if (rootBlock) return { kind: 'blocked', reason: rootBlock.reason }
  }

  const now = (options.now ?? nowAsCanonicalTimestamp)()
  const kind = input.kind as ItemKind
  try {
    const id = generatedId(current.index, kind, options.entropy ?? browserEntropy)
    if (!id) return { kind: 'failed', message: GENERIC_FAILURE_MESSAGE }
    return await applyAddition(
      fileSystem,
      current,
      {
        id,
        kind,
        title: input.title,
        extra: {
          parent_id: input.parentId,
          ...(input.kind === 'claim_leaf' ? { supported_by: supportedBy } : {}),
          created_at: now,
          updated_at: now,
        },
        body: input.body,
      },
      now,
      options,
    )
  } catch (error) {
    return filesystemFailure(error)
  }
}

async function runAddition(
  fileSystem: GardenFileSystem,
  kind: ItemKind,
  title: string,
  body: string,
  extra: Record<string, unknown>,
  options: DirectAdditionOptions,
  timestamp?: string,
): Promise<DirectAdditionResult> {
  try {
    if ((await fileSystem.permission()) !== 'granted') return { kind: 'permission-required' }
    const current = await freshIndex(fileSystem)
    const id = generatedId(current.index, kind, options.entropy ?? browserEntropy)
    if (!id) return { kind: 'failed', message: GENERIC_FAILURE_MESSAGE }
    const now = timestamp ?? (options.now ?? nowAsCanonicalTimestamp)()
    return applyAddition(fileSystem, current, { id, kind, title, extra: { ...extra, created_at: now, updated_at: now }, body }, now, options)
  } catch (error) {
    return filesystemFailure(error)
  }
}

function filesystemFailure(error: unknown): DirectAdditionResult {
  if (error instanceof GardenFileSystemError && error.code === 'permission-denied') {
    return { kind: 'permission-required' }
  }
  return { kind: 'failed', message: GENERIC_FAILURE_MESSAGE }
}
