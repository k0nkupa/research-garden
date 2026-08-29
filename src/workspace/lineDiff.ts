/**
 * A line-based diff between two texts, for showing a Pending Change's exact
 * one-file preview (ADR 0025, ADR 0047, ticket 14).
 *
 * Deliberately not a dependency: ADR 0051 keeps the client's dependency
 * surface focused, and a line-level diff is small enough, and used in
 * exactly one place, that adding a library for it would be the opposite of
 * that. This is the classic longest-common-subsequence line diff -- kept,
 * removed, and added lines, in the order the new text reads.
 */

export type DiffLineKind = 'unchanged' | 'removed' | 'added'

export interface DiffLine {
  readonly kind: DiffLineKind
  readonly text: string
}

/** Splits on `\n` without losing a trailing empty line, so `"a\n"` and `"a"` diff distinctly. */
function toLines(text: string): readonly string[] {
  return text.split('\n')
}

/**
 * The length of the longest common subsequence between every suffix of `a`
 * and every suffix of `b`, as the classic dynamic-programming table -- the
 * standard shape a line diff is built from.
 */
function longestCommonSubsequenceLengths(
  a: readonly string[],
  b: readonly string[],
): readonly (readonly number[])[] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))

  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] =
        a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }

  return table
}

/**
 * A line diff from `before` to `after`. Unchanged lines are kept in place
 * so the reader can follow the surrounding context; a removed line is
 * shown immediately before whatever line it was replaced by.
 */
export function lineDiff(before: string, after: string): readonly DiffLine[] {
  const a = toLines(before)
  const b = toLines(after)
  const table = longestCommonSubsequenceLengths(a, b)

  const lines: DiffLine[] = []
  let i = 0
  let j = 0

  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'unchanged', text: a[i]! })
      i++
      j++
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      lines.push({ kind: 'removed', text: a[i]! })
      i++
    } else {
      lines.push({ kind: 'added', text: b[j]! })
      j++
    }
  }
  while (i < a.length) {
    lines.push({ kind: 'removed', text: a[i]! })
    i++
  }
  while (j < b.length) {
    lines.push({ kind: 'added', text: b[j]! })
    j++
  }

  return lines
}
