import { useMemo, useRef, useState } from 'react'
import type { GardenDiagnostic, IndexedItem } from '../domain/index/gardenIndex'
import { parseGardenDocument } from '../domain/document/gardenDocument'
import type { GardenFileSystem } from '../filesystem/GardenFileSystem'
import { renderGardenMarkdown } from '../domain/markdown/renderGardenMarkdown'
import { isBodyEditableKind } from '../domain/schema/rootEvidence'
import { labelForKind } from '../domain/schema/kindLabels'
import { describeEditItemFailure, type EditItemResult } from '../garden/editItem'
import { describeUndoChangeFailure, type UndoChangeResult } from '../garden/undoChange'
import { ProblemList } from './ProblemList'
import { useAttachments } from './useAttachments'

/**
 * The selected-item panel.
 *
 * ADR 0041: Markdown is rendered for reading, and a plain-text Edit mode is
 * offered only when a person asks for it (ticket 12). Edit mode presents the
 * item's body verbatim -- the same text `renderGardenMarkdown` reads for
 * display -- so what is edited is exactly what was shown. The body is
 * sanitized before it reaches the page in read mode (ADR 0056) --
 * `dangerouslySetInnerHTML` is the only way to mount rendered Markdown, so the
 * sanitizing boundary is what makes it safe, and it lives one call away in
 * `renderGardenMarkdown`.
 *
 * Saving is delegated to `onSave` rather than done here: the Garden Action
 * that performs the verified write needs the current `GardenIndex` and
 * `GardenFileSystem`, which live above this panel, and a successful save has
 * to refresh both -- work this panel has no business doing itself.
 */
export interface ItemPanelProps {
  readonly selected: IndexedItem | undefined
  /** ADR 0052: an item with Diagnostics is readable but not writable. */
  readonly diagnostics: readonly GardenDiagnostic[]
  /** The folder Attachments are read from (ADR 0057), and Edit mode's base text. */
  readonly fileSystem?: GardenFileSystem | undefined
  /** Runs the verified write. Resolves with whatever `editItem` reported. */
  readonly onSave?:
    | ((itemId: string, baseText: string, newBody: string) => Promise<EditItemResult>)
    | undefined
  /** Whether an Undo Snapshot from this session currently applies to `selected`. */
  readonly undoAvailable?: boolean | undefined
  readonly onUndo?: (() => Promise<UndoChangeResult | undefined>) | undefined
}

export function ItemPanel({
  selected,
  diagnostics,
  fileSystem,
  onSave,
  undoAvailable,
  onUndo,
}: ItemPanelProps) {
  const body = useRef<HTMLDivElement>(null)
  const html = useMemo(
    () => (selected ? renderGardenMarkdown(selected.item.body) : ''),
    [selected],
  )

  useAttachments(body, fileSystem, html)

  const [editing, setEditing] = useState(false)
  const [baseText, setBaseText] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [undoing, setUndoing] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [undoError, setUndoError] = useState<string | undefined>(undefined)

  const resetEditState = () => {
    setEditing(false)
    setBaseText(undefined)
    setDraft('')
    setError(undefined)
  }

  const startEditing = async () => {
    if (!selected || !fileSystem) return
    setError(undefined)

    try {
      const text = await fileSystem.read(selected.path)
      const parsed = parseGardenDocument(text)

      setBaseText(text)
      setDraft(parsed.ok ? parsed.document.body : selected.item.body)
      setEditing(true)
    } catch {
      // A lapsed permission or a file that vanished between reading the Tree
      // and choosing Edit: said plainly rather than leaving Edit mode looking
      // like it silently did nothing.
      setError('This item could not be opened for editing. Check the Garden Repository is still available.')
    }
  }

  const cancelEditing = () => resetEditState()

  const save = async () => {
    if (!selected || !onSave || baseText === undefined) return
    setSaving(true)
    try {
      const result = await onSave(selected.item.id, baseText, draft)
      if (result.kind === 'saved') {
        resetEditState()
        return
      }
      setError(describeEditItemFailure(result))
    } finally {
      setSaving(false)
    }
  }

  const undo = async () => {
    if (!onUndo) return
    setUndoing(true)
    setUndoError(undefined)
    try {
      const result = await onUndo()
      if (result) setUndoError(describeUndoChangeFailure(result))
    } finally {
      setUndoing(false)
    }
  }

  if (!selected) {
    return (
      <aside className="item-panel item-panel--empty" aria-label="Selected item">
        <p className="item-panel__invitation">Select an item in the Tree to read it.</p>
      </aside>
    )
  }

  const canEdit = diagnostics.length === 0 && isBodyEditableKind(selected.item.kind) && fileSystem !== undefined
  const showUndo = !editing && undoAvailable === true && onUndo !== undefined

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

      {!editing && diagnostics.length === 0 && selected.item.kind === 'root' && (
        <p className="item-panel__evidence-note">
          A Root's captured evidence is preserved and cannot be edited here; only its
          metadata, such as attribution, is correctable (ADR 0012).
        </p>
      )}

      {!editing && (canEdit || showUndo) && (
        <div className="item-panel__actions">
          {canEdit && (
            <button type="button" className="action action--quiet" onClick={() => void startEditing()}>
              Edit
            </button>
          )}
          {showUndo && (
            <button
              type="button"
              className="action action--quiet"
              onClick={() => void undo()}
              disabled={undoing}
            >
              {undoing ? 'Undoing…' : 'Undo last edit'}
            </button>
          )}
        </div>
      )}

      {!editing && error && (
        <p className="notice notice--failure" role="alert">
          {error}
        </p>
      )}

      {!editing && undoError && (
        <p className="notice notice--failure" role="alert">
          {undoError}
        </p>
      )}

      {editing ? (
        <div className="item-panel__edit">
          <label className="item-panel__edit-label" htmlFor="item-panel-editor">
            Plain Markdown
          </label>
          <textarea
            id="item-panel-editor"
            className="item-panel__editor"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={saving}
            rows={16}
          />

          {error && (
            <p className="notice notice--failure" role="alert">
              {error}
            </p>
          )}

          <div className="item-panel__actions">
            <button
              type="button"
              className="action action--primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="action action--quiet" onClick={cancelEditing} disabled={saving}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="item-panel__body" ref={body} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </aside>
  )
}
