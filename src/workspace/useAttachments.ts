import { useEffect, type RefObject } from 'react'
import type { GardenFileSystem } from '../filesystem/GardenFileSystem'
import { ATTACHMENT_ATTRIBUTE } from '../domain/markdown/renderGardenMarkdown'
import { inlineImageTypeFor } from '../domain/markdown/attachmentPath'

/**
 * Fills in the Attachments a rendered item is waiting for.
 *
 * The renderer deliberately emits Attachment images and links with no source
 * at all (ADR 0057), so nothing is fetched from anywhere and no relative path
 * is ever resolved against the page's own URL. This reads each referenced file
 * out of the Garden Repository the person selected and hands the node its bytes
 * directly, which means an Attachment opens without any request leaving the
 * machine and without navigating the application away from the Garden.
 *
 * Object URLs are revoked when the item changes, because a person reading their
 * way through a Garden would otherwise accumulate one per file they passed.
 */
export function useAttachments(
  container: RefObject<HTMLElement | null>,
  fileSystem: GardenFileSystem | undefined,
  /** Changing this re-resolves; the rendered body is the natural key. */
  renderedBody: string,
): void {
  useEffect(() => {
    const element = container.current
    if (!element || !fileSystem) return

    let cancelled = false
    const created: string[] = []

    const waiting = [...element.querySelectorAll(`[${ATTACHMENT_ATTRIBUTE}]`)]

    void Promise.all(
      waiting.map(async (node) => {
        const path = node.getAttribute(ATTACHMENT_ATTRIBUTE)
        if (path === null) return

        const inlineImage = node.tagName === 'IMG'
        const type = inlineImageTypeFor(path)

        // An image the browser cannot paint inertly is described rather than
        // shown; a link may point at any kind of file.
        if (inlineImage && type === undefined) {
          node.replaceWith(describeUnavailable(node, path))
          return
        }

        try {
          const bytes = await fileSystem.readBytes(path.split('/'))
          if (cancelled) return

          const url = URL.createObjectURL(
            new Blob([bytes as BlobPart], { type: type ?? 'application/octet-stream' }),
          )
          created.push(url)

          if (inlineImage) {
            node.setAttribute('src', url)
            return
          }

          node.setAttribute('href', url)
          // Opened rather than navigated to, so the Garden stays open behind it.
          node.setAttribute('target', '_blank')
          node.setAttribute('rel', 'noopener noreferrer')
          node.setAttribute('download', path.split('/').at(-1) ?? 'attachment')
        } catch {
          // A missing or unreadable Attachment is a gap in the person's folder,
          // not a failure of the item they are reading.
          if (!cancelled) node.replaceWith(describeUnavailable(node, path))
        }
      }),
    )

    return () => {
      cancelled = true
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [container, fileSystem, renderedBody])
}

/** Says what was meant to be there, rather than leaving a dead node. */
function describeUnavailable(node: Element, path: string): Element {
  const said = node.getAttribute('alt') ?? node.textContent ?? ''
  const span = node.ownerDocument.createElement('span')
  span.setAttribute('class', 'refused-media')
  span.textContent = said === '' ? `[${path}]` : `[${said}: ${path}]`
  return span
}
