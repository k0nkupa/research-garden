import { useCallback, useEffect, useState } from 'react'
import type { GardenFileSystem } from '../filesystem/GardenFileSystem'
import { chooseGardenRepository, repositoryFromHandle } from '../filesystem/chooseGardenRepository'
import {
  browserRememberedGardenStore,
  type RememberedGardenStore,
} from '../filesystem/rememberedGarden'
import { createGarden } from './createGarden'
import { openGarden, type OpenGardenResult, type OpenedGarden } from './openGarden'

/**
 * Holds which Garden is open for this browser session.
 *
 * Every outcome the Action layer can report has a state here, so the interface
 * never has to guess and can never show a half-opened Garden. Permission loss
 * and a folder that already holds a Garden are both first-class states with a
 * way back, not failures.
 */
export type GardenSession =
  | { readonly kind: 'no-garden' }
  | { readonly kind: 'working' }
  | { readonly kind: 'open'; readonly garden: OpenedGarden }
  | { readonly kind: 'permission-required'; readonly repositoryName: string }
  /** ADR 0006: the folder already holds a Garden, and nothing was written. */
  | {
      readonly kind: 'already-a-garden'
      readonly repositoryName: string
      readonly found: readonly string[]
    }
  | { readonly kind: 'failed'; readonly message: string }

export interface GardenSessionControls {
  readonly session: GardenSession
  readonly createFromPicker: () => Promise<void>
  readonly openFromPicker: () => Promise<void>
  /** Opens the folder already chosen, without asking for it again. */
  readonly openChosen: () => Promise<void>
  /** Re-request permission for the folder already chosen, then open it again. */
  readonly retryPermission: () => Promise<void>
  readonly dismiss: () => void
  /** ADR 0060: the folder this browser remembers, if any. */
  readonly remembered: { readonly name: string } | undefined
  readonly resumeRemembered: () => Promise<void>
  readonly forgetRemembered: () => Promise<void>
}

export interface GardenSessionDependencies {
  readonly choose?: typeof chooseGardenRepository
  readonly store?: RememberedGardenStore
}

export function useGardenSession(
  dependencies: GardenSessionDependencies = {},
): GardenSessionControls {
  const [session, setSession] = useState<GardenSession>({ kind: 'no-garden' })
  // Kept so a lapsed permission can be re-requested for the same folder rather
  // than making the person find it again.
  const [chosen, setChosen] = useState<GardenFileSystem | undefined>(undefined)
  const [remembered, setRemembered] = useState<{ name: string } | undefined>(undefined)

  const choose = dependencies.choose ?? chooseGardenRepository
  const [store] = useState<RememberedGardenStore>(
    () => dependencies.store ?? browserRememberedGardenStore(),
  )

  useEffect(() => {
    let cancelled = false
    void store
      .recall()
      .then((found) => {
        if (!cancelled && found) setRemembered({ name: found.name })
      })
      // A browser that will not let us remember anything is not a failure worth
      // showing: the person can still choose a folder.
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [store])

  /** Returns whether a Garden actually opened. */
  const settle = useCallback((result: OpenGardenResult, fileSystem: GardenFileSystem) => {
    if (result.kind === 'opened') {
      setSession({ kind: 'open', garden: result.garden })
      return true
    }
    if (result.kind === 'permission-required') {
      setSession({ kind: 'permission-required', repositoryName: fileSystem.repositoryName })
    } else setSession({ kind: 'failed', message: result.message })
    return false
  }, [])

  const openFrom = useCallback(
    async (fileSystem: GardenFileSystem) => {
      setSession({ kind: 'working' })
      return settle(await openGarden(fileSystem), fileSystem)
    },
    [settle],
  )

  /**
   * Runs an action against a folder the person picks, remembering the folder
   * only if that action actually opened a Garden. ADR 0060 exists so a person
   * can resume work, and there is no work to resume in a folder that refused.
   */
  const withPickedFolder = useCallback(
    async (run: (fileSystem: GardenFileSystem) => Promise<boolean>) => {
      const chosenResult = await choose()

      if (chosenResult.kind === 'cancelled') return
      if (chosenResult.kind === 'unavailable') {
        setSession({
          kind: 'failed',
          message: 'This browser could not open a folder for Research Garden.',
        })
        return
      }

      setChosen(chosenResult.fileSystem)
      if (!(await run(chosenResult.fileSystem))) return

      const name = chosenResult.fileSystem.repositoryName
      await store
        .remember({ handle: chosenResult.handle, name })
        .then(() => setRemembered({ name }))
        .catch(() => undefined)
    },
    [choose, store],
  )

  const openFromPicker = useCallback(
    () => withPickedFolder(openFrom),
    [openFrom, withPickedFolder],
  )

  const createFromPicker = useCallback(
    () =>
      withPickedFolder(async (fileSystem) => {
        setSession({ kind: 'working' })
        const created = await createGarden(fileSystem)

        if (created.kind === 'created') return settle(created.result, fileSystem)

        if (created.kind === 'conflicting') {
          setSession({
            kind: 'already-a-garden',
            repositoryName: fileSystem.repositoryName,
            found: created.found,
          })
        } else if (created.kind === 'permission-required') {
          setSession({ kind: 'permission-required', repositoryName: created.repositoryName })
        } else setSession({ kind: 'failed', message: created.message })

        return false
      }),
    [settle, withPickedFolder],
  )

  const openChosen = useCallback(async () => {
    if (chosen) await openFrom(chosen)
  }, [chosen, openFrom])

  const retryPermission = useCallback(async () => {
    if (!chosen) return
    await chosen.requestPermission()
    await openFrom(chosen)
  }, [chosen, openFrom])

  const resumeRemembered = useCallback(async () => {
    const found = await store.recall().catch(() => undefined)
    if (!found) return

    // ADR 0060: permission is never remembered, so it is asked for again here.
    const fileSystem = repositoryFromHandle(found.handle)
    setChosen(fileSystem)
    await fileSystem.requestPermission().catch(() => undefined)
    await openFrom(fileSystem)
  }, [openFrom, store])

  const forgetRemembered = useCallback(async () => {
    await store.forget().catch(() => undefined)
    setRemembered(undefined)
  }, [store])

  const dismiss = useCallback(() => setSession({ kind: 'no-garden' }), [])

  return {
    session,
    createFromPicker,
    openFromPicker,
    openChosen,
    retryPermission,
    dismiss,
    remembered,
    resumeRemembered,
    forgetRemembered,
  }
}
