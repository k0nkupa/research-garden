/**
 * Identity and placement for canonical Garden items.
 *
 * ADR 0034 combines two things that pull in opposite directions: relationships
 * need an identity that survives renaming, and a person needs a folder that is
 * pleasant to read without Research Garden. So the kind-prefixed ULID lives in
 * frontmatter and the filename is a readable title slug, with a short identity
 * suffix appended only when two titles would otherwise collide.
 */

/** The eight canonical kinds, in the order the design record presents them. */
export const GARDEN_ITEM_KINDS = [
  'seed',
  'root',
  'branch',
  'claim_leaf',
  'question_leaf',
  'idea_leaf',
  'observation_leaf',
  'harvest',
] as const

export type GardenItemKind = (typeof GARDEN_ITEM_KINDS)[number]

/**
 * Crockford base32 without I, L, O, or U. The first character is bounded to 0-7
 * because a ULID's 48-bit timestamp cannot overflow into the higher digits.
 */
const ULID_PATTERN = /^[0-7][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/

export interface ParsedItemId {
  readonly kind: GardenItemKind
  readonly ulid: string
}

/**
 * Kinds are matched longest-first so that a kind which is a prefix of another
 * could never win the match. No current kind is a prefix of another -- an
 * invariant the tests assert directly -- so this is belt and braces against a
 * kind added later.
 */
const KINDS_BY_LENGTH = [...GARDEN_ITEM_KINDS].sort((a, b) => b.length - a.length)

export function parseItemId(id: string): ParsedItemId | undefined {
  for (const kind of KINDS_BY_LENGTH) {
    const prefix = `${kind}_`
    if (!id.startsWith(prefix)) continue

    const ulid = id.slice(prefix.length)
    return ULID_PATTERN.test(ulid) ? { kind, ulid } : undefined
  }
  return undefined
}

export function isValidItemId(id: string, kind: GardenItemKind): boolean {
  return parseItemId(id)?.kind === kind
}

/** Long enough to read, short enough that a folder listing stays scannable. */
const MAXIMUM_SLUG_LENGTH = 80

export function titleSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    // Strip the combining marks NFKD separated out, keeping the base letters, so
    // an accented title transliterates rather than losing its characters.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (slug === '') return 'untitled'

  return slug.length <= MAXIMUM_SLUG_LENGTH
    ? slug
    : slug.slice(0, MAXIMUM_SLUG_LENGTH).replace(/-+[^-]*$/, '').replace(/-+$/, '')
}

export interface NameableItem {
  readonly id: string
  readonly kind: GardenItemKind
  readonly title: string
}

/** Enough ULID to disambiguate without turning the filename back into an id. */
const INITIAL_SUFFIX_LENGTH = 6

/**
 * Chooses a filename for an item, given the names already taken in its
 * directory.
 *
 * The suffix comes from the item's own ULID rather than a counter, so the same
 * item always resolves to the same name and two Gardens merged by hand do not
 * renumber each other.
 */
export function fileNameFor(item: NameableItem, taken: ReadonlySet<string>): string {
  const slug = titleSlug(item.title)
  const plain = `${slug}.md`
  if (!taken.has(plain)) return plain

  const ulid = parseItemId(item.id)?.ulid ?? ''
  for (let length = INITIAL_SUFFIX_LENGTH; length <= ulid.length; length += 1) {
    const candidate = `${slug}-${ulid.slice(-length)}.md`
    if (!taken.has(candidate)) return candidate
  }

  // Two items cannot share a ULID, so reaching here means the full identity is
  // already on disk; the id itself is then the only honest name left.
  return `${slug}-${item.id}.md`
}

/** ADR 0011: canonical Markdown is organized by botanical type. */
const DIRECTORY_BY_KIND: Record<GardenItemKind, string> = {
  seed: 'seeds',
  root: 'roots',
  branch: 'branches',
  // Every Leaf kind shares one directory; the kind is carried by frontmatter,
  // not by where the file sits.
  claim_leaf: 'leaves',
  question_leaf: 'leaves',
  idea_leaf: 'leaves',
  observation_leaf: 'leaves',
  harvest: 'harvests',
}

export function directoryForKind(kind: GardenItemKind): string {
  return DIRECTORY_BY_KIND[kind]
}

/** The directories `openGarden` scans for canonical Markdown. */
export const CANONICAL_DIRECTORIES: readonly string[] = [
  ...new Set(GARDEN_ITEM_KINDS.map(directoryForKind)),
]

/** ADR 0011: user-owned supporting files, never canonical knowledge. */
export const ATTACHMENTS_DIRECTORY = 'attachments'

/** ADR 0026, ADR 0050: rebuildable and operational state, never knowledge. */
export const OPERATIONAL_DIRECTORY = '.research-garden'
