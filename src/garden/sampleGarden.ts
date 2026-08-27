import { contentHash } from '../domain/hash'
import type { GardenItemKind } from '../domain/schema/itemIdentity'
import type { ItemIdFactory } from '../domain/schema/ulid'

/**
 * The Sample Garden.
 *
 * ADR 0006: Create Garden materializes this as real files in the folder a
 * person chose, rather than maintaining a browser-only demo, because every
 * Garden being made of user-owned files is the promise the product is built on.
 *
 * Its shape is chosen to make the defining workflow demonstrable from a
 * standing start (ADR 0070): two Claim Leaves that genuinely contradict each
 * other, each with its own Root, and a Question Leaf that the contradiction
 * leaves open. It deliberately contains no Harvest -- the Harvest is what
 * ChatGPT proposes and a person approves, and shipping one would give away the
 * ending.
 *
 * The disagreement is real. Ericsson's 1993 study and Macnamara's 2014
 * meta-analysis reach genuinely different conclusions about how much deliberate
 * practice explains, which is a better teacher than an invented conflict.
 */

export interface SampleItem {
  readonly id: string
  readonly kind: GardenItemKind
  readonly title: string
  readonly frontmatter: Record<string, unknown>
  readonly body: string
}

export interface SampleGardenDependencies {
  readonly nextId: ItemIdFactory
  /** An ISO 8601 UTC instant (ADR 0077). */
  readonly now: () => string
}

const EXCERPTS = {
  ericsson:
    'The differences between expert performers and normal adults reflect a life-long\n' +
    'period of deliberate effort to improve performance in a specific domain.\n',
  macnamara:
    'Deliberate practice explained 26% of the variance in performance for games,\n' +
    '21% for music, 18% for sports, 4% for education, and less than 1% for\n' +
    'professions. We conclude that deliberate practice is important, but not as\n' +
    'important as has been argued.\n',
} as const

export async function sampleGardenDrafts(
  dependencies: SampleGardenDependencies,
): Promise<readonly SampleItem[]> {
  const { nextId, now } = dependencies
  // One reading of the clock: a brand-new item has never been edited, so its
  // two timestamps are the same instant and must not straddle a tick (ADR 0077).
  const createdAt = now()
  const timestamps = { created_at: createdAt, updated_at: createdAt }

  const seedId = nextId('seed')
  const branchId = nextId('branch')
  const ericssonRootId = nextId('root')
  const macnamaraRootId = nextId('root')
  const practiceExplainsId = nextId('claim_leaf')
  const practiceExplainsLittleId = nextId('claim_leaf')
  const openQuestionId = nextId('question_leaf')
  const domainIdeaId = nextId('idea_leaf')

  /**
   * Builds an item from one statement of its identity, so the id and title in
   * the frontmatter cannot drift from the ones used to name the file.
   */
  const item = (
    id: string,
    kind: GardenItemKind,
    title: string,
    extra: Record<string, unknown>,
    body: string,
  ): SampleItem => ({
    id,
    kind,
    title,
    frontmatter: { schema_version: 1, id, kind, title, ...extra, ...timestamps },
    body,
  })

  return [
    item(
      seedId,
      'seed',
      'Something I read about the 10,000 hour rule',
      {},
      'Someone repeated the 10,000 hour rule to me as settled fact today. I have a\n' +
        'vague memory that the research it came from says something narrower, and that\n' +
        'a later paper disagreed with it outright. Worth actually checking.\n',
    ),
    item(
      branchId,
      'branch',
      'Deliberate practice',
      { state: 'active', relations: [{ type: 'derived_from', target: seedId }] },
      'What deliberate practice does and does not explain about expert performance.\n',
    ),
    item(
      ericssonRootId,
      'root',
      'Ericsson, Krampe & Tesch-Romer (1993)',
      {
        origin_url: 'https://psycnet.apa.org/record/1993-40718-001',
        captured_at: createdAt,
        content_hash: await contentHash(EXCERPTS.ericsson),
        attribution: 'K. Anders Ericsson, Ralf Th. Krampe, Clemens Tesch-Romer',
      },
      EXCERPTS.ericsson,
    ),
    item(
      macnamaraRootId,
      'root',
      'Macnamara, Hambrick & Oswald (2014)',
      {
        origin_url: 'https://journals.sagepub.com/doi/10.1177/0956797614535810',
        captured_at: createdAt,
        content_hash: await contentHash(EXCERPTS.macnamara),
        attribution: 'Brooke N. Macnamara, David Z. Hambrick, Frederick L. Oswald',
      },
      EXCERPTS.macnamara,
    ),
    item(
      practiceExplainsId,
      'claim_leaf',
      'Most of expertise is deliberate practice',
      {
        parent_id: branchId,
        supported_by: [ericssonRootId],
        relations: [{ type: 'contradicts', target: practiceExplainsLittleId }],
      },
      'Expert performance is chiefly the product of sustained deliberate practice\n' +
        'rather than of stable individual differences.\n',
    ),
    item(
      practiceExplainsLittleId,
      'claim_leaf',
      'Little of expertise is deliberate practice',
      { parent_id: branchId, supported_by: [macnamaraRootId] },
      'Across domains, deliberate practice accounts for a minority of the variance in\n' +
        'performance, and very little of it outside games, music, and sport.\n',
    ),
    item(
      openQuestionId,
      'question_leaf',
      'How much does deliberate practice actually explain?',
      { parent_id: branchId },
      'Both Claims are supported, and they disagree. What would a fair reading of\n' +
        'both pieces of evidence conclude?\n',
    ),
    item(
      domainIdeaId,
      'idea_leaf',
      'Perhaps they measured different domains',
      { parent_id: branchId },
      'One studied violinists; the other pooled everything from chess to professional\n' +
        'work. The disagreement may be about where the rule applies rather than\n' +
        'whether it holds at all.\n',
    ),
  ]
}
