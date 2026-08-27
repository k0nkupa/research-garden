import { useCallback, useState } from 'react'
import type { GardenFileSystem } from '../filesystem/GardenFileSystem'
import { chooseGardenRepository } from '../filesystem/chooseGardenRepository'
import { openGarden, type OpenedGarden } from './openGarden'

/**
 * Holds which Garden is open for this browser session.
 *
 * Every outcome the Action layer can report has a state here, so the interface
 * never has to guess and can never show a half-opened Garden. Permission loss
 * is a first-class state with a way back, not a failure.
 */
export type GardenSession =
  | { readonly kind: 'no-garden' }
  | { readonly kind: 'opening' }
  | { readonly kind: 'open'; readonly garden: OpenedGarden }
  | { readonly kind: 'permission-required'; readonly repositoryName: string }
  | { readonly kind: 'failed'; readonly message: string }

export interface GardenSessionControls {
  readonly session: GardenSession
  readonly openFromPicker: () => Promise<void>
  /** Re-request permission for the folder already chosen, then open it again. */
  readonly retryPermission: () => Promise<void>
  readonly dismiss: () => void
}

export function useGardenSession(
  choose: typeof chooseGardenRepository = chooseGardenRepository,
): GardenSessionControls {
  const [session, setSession] = useState<GardenSession>({ kind: 'no-garden' })
  // Kept so a lapsed permission can be re-requested for the same folder rather
  // than making the person find it again.
  const [chosen, setChosen] = useState<GardenFileSystem | undefined>(undefined)

  const openFrom = useCallback(async (fileSystem: GardenFileSystem) => {
    setSession({ kind: 'opening' })
    const result = await openGarden(fileSystem)

    if (result.kind === 'opened') setSession({ kind: 'open', garden: result.garden })
    else if (result.kind === 'permission-required') {
      setSession({ kind: 'permission-required', repositoryName: result.repositoryName })
    } else setSession({ kind: 'failed', message: result.message })
  }, [])

  const openFromPicker = useCallback(async () => {
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
    await openFrom(chosenResult.fileSystem)
  }, [choose, openFrom])

  const retryPermission = useCallback(async () => {
    if (!chosen) return
    await chosen.requestPermission()
    await openFrom(chosen)
  }, [chosen, openFrom])

  const dismiss = useCallback(() => setSession({ kind: 'no-garden' }), [])

  return { session, openFromPicker, retryPermission, dismiss }
}
