import { useMemo, useRef } from 'react'
import type { GardenDiagnostic, IndexedItem } from '../domain/index/gardenIndex'
import type { GardenFileSystem } from '../filesystem/GardenFileSystem'
import { renderGardenMarkdown } from '../domain/markdown/renderGardenMarkdown'
import { labelForKind } from '../domain/schema/kindLabels'
import { ProblemList } from './ProblemList'
import { useAttachments } from './useAttachments'

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
  /** ADR 0052: an item with Diagnostics is readable but not writable. */
  readonly diagnostics: readonly GardenDiagnostic[]
  /** The folder Attachments are read from (ADR 0057). */
  readonly fileSystem?: GardenFileSystem | undefined
}

export function ItemPanel({ selected, diagnostics, fileSystem }: ItemPanelProps) {
  const body = useRef<HTMLDivElement>(null)
  const html = useMemo(
    () => (selected ? renderGardenMarkdown(selected.item.body) : ''),
    [selected],
  )

  useAttachments(body, fileSystem, html)

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

      {diagnostics.length > 0 && (
        <div className="item-panel__diagnostics" role="status">
          <p className="item-panel__diagnostics-heading">
            This item needs attention and cannot be changed until it validates.
          </p>
          <ProblemList problems={diagnostics.flatMap((diagnostic) => diagnostic.problems)} />
        </div>
      )}

      <div
        className="item-panel__body"
        ref={body}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </aside>
  )
}
