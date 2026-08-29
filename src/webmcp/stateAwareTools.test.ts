import { describe, expect, it, vi } from 'vitest'
import type { ModelContextTool } from './modelContext'
import {
  createStateAwareToolRegistration,
  type StateAwareToolBundle,
  type ToolRegistrationState,
} from './stateAwareTools'

const TOOL_SCHEMA = { type: 'object', properties: {} }

function tool(name: string): ModelContextTool {
  return {
    name,
    description: `${name} description`,
    inputSchema: TOOL_SCHEMA,
    async execute() {
      return { ok: true }
    },
  }
}

const OPEN_TOOL = tool('inspect_garden')
const SELECTED_TOOL = tool('trace_evidence')
const FOCUSED_TOOL = tool('explore_branch')
const PENDING_TOOL = tool('list_pending_changes')

const OPEN: StateAwareToolBundle = {
  id: 'open-garden',
  tools: [OPEN_TOOL],
  isRelevant: (state) => state.gardenOpen,
}
const SELECTED: StateAwareToolBundle = {
  id: 'selected-item',
  tools: [SELECTED_TOOL],
  isRelevant: (state) => state.selectedItemId !== undefined,
}
const FOCUSED: StateAwareToolBundle = {
  id: 'focused-branch',
  tools: [FOCUSED_TOOL],
  isRelevant: (state) => state.focusedBranchId !== undefined,
}
const PENDING: StateAwareToolBundle = {
  id: 'pending-changes',
  tools: [PENDING_TOOL],
  isRelevant: (state) => state.hasPendingChanges,
}

const EMPTY: ToolRegistrationState = {
  agentAccess: false,
  gardenOpen: false,
  selectedItemId: undefined,
  focusedBranchId: undefined,
  hasPendingChanges: false,
}

describe('state-aware registered surface', () => {
  it('keeps every Garden bundle unavailable until Agent Access is enabled', () => {
    const registration = createStateAwareToolRegistration(undefined, [OPEN, SELECTED, FOCUSED, PENDING])

    registration.update({ ...EMPTY, gardenOpen: true, selectedItemId: 'leaf-1', hasPendingChanges: true })

    expect(registration.inspect().names).toEqual([])
  })

  it('is inspectable without a WebMCP host and follows each state dimension', () => {
    const registration = createStateAwareToolRegistration(undefined, [OPEN, SELECTED, FOCUSED, PENDING])

    registration.update({ ...EMPTY, agentAccess: true, gardenOpen: true, selectedItemId: 'leaf-1' })
    expect(registration.inspect().names).toEqual(['inspect_garden', 'trace_evidence'])

    registration.update({ ...EMPTY, agentAccess: true, gardenOpen: true, focusedBranchId: 'branch-1' })
    expect(registration.inspect().names).toEqual(['inspect_garden', 'explore_branch'])

    registration.update({ ...EMPTY, agentAccess: true, gardenOpen: true, hasPendingChanges: true })
    expect(registration.inspect().names).toEqual(['inspect_garden', 'list_pending_changes'])
  })

  it('keeps tool schemas stable while availability changes', () => {
    const registration = createStateAwareToolRegistration(undefined, [OPEN, SELECTED])

    registration.update({ ...EMPTY, agentAccess: true, gardenOpen: true })
    const openSchema = registration.inspect().tools[0]?.inputSchema
    registration.update({ ...EMPTY, agentAccess: true, gardenOpen: true, selectedItemId: 'leaf-1' })

    expect(registration.inspect().tools.map((candidate) => candidate.inputSchema)).toEqual([
      openSchema,
      TOOL_SCHEMA,
    ])
    expect(registration.inspect().tools[0]).toBe(OPEN_TOOL)
  })
})

describe('state-aware WebMCP registration lifecycle', () => {
  it('registers newly relevant bundles and aborts bundles that become irrelevant', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    const registration = createStateAwareToolRegistration(
      { modelContext: { registerTool } },
      [OPEN, SELECTED, FOCUSED, PENDING],
    )

    registration.update({ ...EMPTY, agentAccess: true, gardenOpen: true, selectedItemId: 'leaf-1' })
    await Promise.resolve()
    expect(registerTool).toHaveBeenCalledTimes(2)
    const openOptions = registerTool.mock.calls[0]?.[1] as { signal: AbortSignal }
    const selectedOptions = registerTool.mock.calls[1]?.[1] as { signal: AbortSignal }

    registration.update({ ...EMPTY, agentAccess: true, gardenOpen: true, focusedBranchId: 'branch-1' })
    await Promise.resolve()
    expect(registerTool).toHaveBeenCalledTimes(3)
    expect(selectedOptions.signal.aborted).toBe(true)
    expect(openOptions.signal.aborted).toBe(false)
    expect(registration.inspect().names).toEqual(['inspect_garden', 'explore_branch'])
  })

  it('disconnects every active bundle immediately and clears the inspectable surface', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    const registration = createStateAwareToolRegistration(
      { modelContext: { registerTool } },
      [OPEN, SELECTED, FOCUSED, PENDING],
    )

    registration.update({
      agentAccess: true,
      gardenOpen: true,
      selectedItemId: 'leaf-1',
      focusedBranchId: 'branch-1',
      hasPendingChanges: true,
    })
    await Promise.resolve()
    const signals = (registerTool.mock.calls as [unknown, { signal: AbortSignal }][]).map(
      (call) => call[1].signal,
    )

    registration.disconnect()

    expect(signals.every((signal) => signal.aborted)).toBe(true)
    expect(registration.inspect().tools).toEqual([])
    expect(registration.inspect().names).toEqual([])
  })
})
