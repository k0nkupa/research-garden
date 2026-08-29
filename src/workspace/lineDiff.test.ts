import { describe, expect, it } from 'vitest'
import { lineDiff } from './lineDiff'

describe('diffing identical text', () => {
  it('marks every line unchanged', () => {
    const diff = lineDiff('a\nb\nc', 'a\nb\nc')

    expect(diff).toEqual([
      { kind: 'unchanged', text: 'a' },
      { kind: 'unchanged', text: 'b' },
      { kind: 'unchanged', text: 'c' },
    ])
  })
})

describe('a line added', () => {
  it('marks only the new line as added, everything else unchanged', () => {
    const diff = lineDiff('a\nc', 'a\nb\nc')

    expect(diff).toEqual([
      { kind: 'unchanged', text: 'a' },
      { kind: 'added', text: 'b' },
      { kind: 'unchanged', text: 'c' },
    ])
  })
})

describe('a line removed', () => {
  it('marks only the missing line as removed, everything else unchanged', () => {
    const diff = lineDiff('a\nb\nc', 'a\nc')

    expect(diff).toEqual([
      { kind: 'unchanged', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'unchanged', text: 'c' },
    ])
  })
})

describe('a line changed', () => {
  it('shows the old line removed and the new line added, not an unrelated shuffle', () => {
    const diff = lineDiff('a\nold\nc', 'a\nnew\nc')

    expect(diff).toEqual([
      { kind: 'unchanged', text: 'a' },
      { kind: 'removed', text: 'old' },
      { kind: 'added', text: 'new' },
      { kind: 'unchanged', text: 'c' },
    ])
  })
})

describe('completely different text', () => {
  it('removes everything from before and adds everything from after', () => {
    const diff = lineDiff('one\ntwo', 'three\nfour')

    expect(diff).toEqual([
      { kind: 'removed', text: 'one' },
      { kind: 'removed', text: 'two' },
      { kind: 'added', text: 'three' },
      { kind: 'added', text: 'four' },
    ])
  })
})

describe('an empty before or after', () => {
  it('marks every line of a brand new text as added', () => {
    const diff = lineDiff('', 'a\nb')

    expect(diff).toEqual([
      { kind: 'removed', text: '' },
      { kind: 'added', text: 'a' },
      { kind: 'added', text: 'b' },
    ])
  })

  it('marks every line of an emptied text as removed', () => {
    const diff = lineDiff('a\nb', '')

    expect(diff).toEqual([
      { kind: 'removed', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: '' },
    ])
  })
})

describe('a trailing newline', () => {
  it('diffs "a\\n" and "a" distinctly -- a real content difference, not noise', () => {
    const diff = lineDiff('a\n', 'a')

    expect(diff).toEqual([
      { kind: 'unchanged', text: 'a' },
      { kind: 'removed', text: '' },
    ])
  })
})

describe('reconstructing the after text', () => {
  it('the added and unchanged lines, in order, join back into exactly `after`', () => {
    const before = 'Line one.\nOld middle line.\nLine three.\n'
    const after = 'Line one.\nA changed middle line.\nAn added line.\nLine three.\n'

    const diff = lineDiff(before, after)
    const reconstructed = diff
      .filter((line) => line.kind !== 'removed')
      .map((line) => line.text)
      .join('\n')

    expect(reconstructed).toBe(after)
  })

  it('the removed and unchanged lines, in order, join back into exactly `before`', () => {
    const before = 'Line one.\nOld middle line.\nLine three.\n'
    const after = 'Line one.\nA changed middle line.\nAn added line.\nLine three.\n'

    const diff = lineDiff(before, after)
    const reconstructed = diff
      .filter((line) => line.kind !== 'added')
      .map((line) => line.text)
      .join('\n')

    expect(reconstructed).toBe(before)
  })
})
