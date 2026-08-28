import { contentHash } from '../domain/hash'
import { parseGardenDocument } from '../domain/document/gardenDocument'
import { validateGardenItem, type GardenItem, type ValidationProblem } from '../domain/schema/gardenItem'
import type { GardenFileSystem, GardenPath } from '../filesystem/GardenFileSystem'

/**
 * The verified tail every canonical write shares (ADR 0055).
 *
 * A browser write call resolving is not completion evidence on its own: this
 * writes once, rereads what is actually on disk, revalidates it against the
 * schema, and confirms its content hash matches what was intended before
 * anything is reported as saved. Both a human edit (`editItem`) and an Undo
 * (`undoChange`) end here, so the guarantee cannot drift between the two.
 */

export interface VerifiedWriteSuccess {
  readonly kind: 'verified'
  readonly text: string
  readonly hash: string
  readonly item: GardenItem
}

export interface VerifiedWriteFailure {
  readonly kind: 'verification-failed'
  readonly message: string
}

export type VerifiedWriteResult = VerifiedWriteSuccess | VerifiedWriteFailure

export async function writeAndVerify(
  fileSystem: GardenFileSystem,
  path: GardenPath,
  newText: string,
): Promise<VerifiedWriteResult> {
  const expectedHash = await contentHash(newText)

  await fileSystem.write(path, newText)
  const rereadText = await fileSystem.read(path)

  const parsed = parseGardenDocument(rereadText)
  if (!parsed.ok) {
    return {
      kind: 'verification-failed',
      message: `The file written to ${path.join('/')} no longer parses: ${parsed.error.message}`,
    }
  }

  const validated = validateGardenItem(parsed.document.frontmatter, parsed.document.body)
  if (!validated.ok) {
    return {
      kind: 'verification-failed',
      message: `The file written to ${path.join('/')} no longer validates: ${describeProblems(validated.problems)}`,
    }
  }

  const rereadHash = await contentHash(rereadText)
  if (rereadHash !== expectedHash) {
    return {
      kind: 'verification-failed',
      message: `What was read back from ${path.join('/')} does not match what Research Garden wrote.`,
    }
  }

  return { kind: 'verified', text: rereadText, hash: rereadHash, item: validated.item }
}

function describeProblems(problems: readonly ValidationProblem[]): string {
  return problems.map((problem) => `${problem.field} ${problem.message}`).join('; ')
}
