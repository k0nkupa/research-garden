import type { CoreReadToolsRuntime } from './coreReadTools'
import { createCoreReadToolsBundle } from './coreReadTools'
import type { DirectAdditionToolsRuntime } from './directAdditionTools'
import { createDirectAdditionToolsBundle } from './directAdditionTools'
import type { PendingChangeToolsRuntime } from './pendingChangeTools'
import { createPendingChangeToolsBundles } from './pendingChangeTools'
import type { ProposalToolsRuntime } from './proposalTools'
import { createProposalToolsBundles } from './proposalTools'
import { createResearchToolsBundles } from './researchTools'
import type { StateAwareToolBundle } from './stateAwareTools'

/** The single composition used by Workspace and direct acceptance harnesses. */
export type GardenToolBundleRuntime =
  & CoreReadToolsRuntime
  & DirectAdditionToolsRuntime
  & ProposalToolsRuntime
  & PendingChangeToolsRuntime

export function createGardenToolBundles(
  runtime: GardenToolBundleRuntime,
): readonly StateAwareToolBundle[] {
  return [
    createCoreReadToolsBundle(runtime),
    createDirectAdditionToolsBundle(runtime),
    ...createResearchToolsBundles(runtime),
    ...createProposalToolsBundles(runtime),
    ...createPendingChangeToolsBundles(runtime),
  ]
}
