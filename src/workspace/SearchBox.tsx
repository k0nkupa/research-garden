import { useId, useMemo, useState } from 'react'
import type { GardenIndex } from '../domain/index/gardenIndex'
import { searchGardenIndex } from '../domain/index/gardenSearch'
import { labelForKind } from '../domain/schema/kindLabels'

/**
 * Search, reachable from the workspace bar (ticket 11).
 *
 * Matching, ranking, and the ten/twenty-five bound (ADR 0038) all live in
 * `searchGardenIndex`, a pure function over the Garden Index (ADR 0050). This
 * component only asks it a question on every keystroke and lists what comes
 * back -- there is no separate UI-side limit to keep in sync with the real
 * one.
 *
 * A result's snippet is rendered as a plain text child, never through
 * `dangerouslySetInnerHTML`. A Root or Leaf body is untrusted content (ADR
 * 0056); React escapes text children, so a snippet sliced out of a hostile
 * body can print as text but can never become markup.
 */
export interface SearchBoxProps {
  readonly index: GardenIndex
  /** Selects a result. The Tree is responsible for revealing it (ADR 0014). */
  readonly onSelect: (itemId: string) => void
}

export function SearchBox({ index, onSelect }: SearchBoxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const listboxId = useId()

  const trimmed = query.trim()
  const results = useMemo(() => searchGardenIndex(index, query), [index, query])

  const choose = (itemId: string) => {
    onSelect(itemId)
    // The query stays: a person who searched "gradient" and picked one match
    // often wants the next one, and re-typing it would be a poor trade for a
    // dropdown that closes itself.
    setOpen(false)
  }

  return (
    <div className="workspace__search" role="search">
      <input
        type="text"
        role="combobox"
        aria-label="Search the Garden"
        aria-expanded={open && trimmed !== ''}
        aria-controls={listboxId}
        aria-autocomplete="list"
        className="workspace__search-input"
        placeholder="Search the Garden"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          // Stopped locally rather than left to bubble: the Tree also gives
          // Escape a meaning (clearing focus), and a person typing in a text
          // box should never trigger it by accident.
          if (event.key === 'Escape' && open) {
            event.stopPropagation()
            setOpen(false)
          }
        }}
      />

      {open && trimmed !== '' && (
        <ul id={listboxId} role="listbox" aria-label="Search results" className="workspace__search-results">
          {results.length === 0 ? (
            <li role="presentation" className="workspace__search-empty">
              No matches for “{trimmed}”
            </li>
          ) : (
            results.map((result) => (
              // The option itself is the interactive element, not a button
              // nested inside it: the ARIA listbox pattern does not allow an
              // option to contain an interactive descendant, and a person
              // tabbing to it needs Enter or Space, not a click, to work.
              <li
                key={result.itemId}
                role="option"
                aria-selected={false}
                tabIndex={0}
                className="workspace__search-result"
                onClick={() => choose(result.itemId)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  choose(result.itemId)
                }}
              >
                <span className="workspace__search-kind">{labelForKind(result.kind)}</span>
                <span className="workspace__search-title">{result.title}</span>
                {result.snippet !== '' && (
                  <span className="workspace__search-snippet">{result.snippet}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
