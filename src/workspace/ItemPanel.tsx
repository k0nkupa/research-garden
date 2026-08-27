import { useMemo } from 'react'
import type { IndexedItem } from '../domain/index/gardenIndex'
import { renderGardenMarkdown } from '../domain/markdown/renderGardenMarkdown'
import { labelForKind } from '../domain/schema/kindLabels'

/**
 * The selected-item panel.
 *
 * ADR 0041: Markdown is rendered for reading, and a plain-text Edit mode is
 * offered only when a person asks for it (ticket 12). The body is sanitized
 * before it reaches the page (ADR 0056) -- `dangerouslySetInnerHTML` is the
 * only way to mount rendered Markdown, so the sanitizing boundary is what makes
 * it safe, and it lives one call away in `renderGardenMarkdown`.
 */
export interface ItemPanelProps {
  readonly selected: IndexedItem | undefined
}

export function ItemPanel({ selected }: ItemPanelProps) {
  const html = useMemo(
    () => (selected ? renderGardenMarkdown(selected.body) : ''),
    [selected],
  )

  if (!selected) {
    return (
      <aside className="item-panel item-panel--empty" aria-label="Selected item">
        <p className="item-panel__invitation">Select an item in the Tree to read it.</p>
      </aside>
    )
  }

  return (
    <aside className="item-panel" aria-label="Selected item">
      <header className="item-panel__header">
        <p className="item-panel__kind">{labelForKind(selected.item.kind)}</p>
        <h2 className="item-panel__title">{selected.item.title}</h2>
      </header>

      <div className="item-panel__body" dangerouslySetInnerHTML={{ __html: html }} />
    </aside>
  )
}
