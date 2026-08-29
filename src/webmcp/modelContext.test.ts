import { describe, expect, it, vi } from 'vitest'
import { asModelContextRegistry, registerModelContextTool } from './modelContext'

const TOOL = {
  name: 'describe_research_garden',
  description: 'Describes Research Garden.',
  async execute() {
    return { ok: true }
  },
}

describe('asModelContextRegistry', () => {
  it('is undefined when navigator is not an object', () => {
    expect(asModelContextRegistry(undefined)).toBeUndefined()
    expect(asModelContextRegistry(null)).toBeUndefined()
    expect(asModelContextRegistry('navigator')).toBeUndefined()
  })

  it('is undefined when navigator has no modelContext', () => {
    expect(asModelContextRegistry({})).toBeUndefined()
  })

  it('is undefined when modelContext is present but has no registerTool method', () => {
    expect(asModelContextRegistry({ modelContext: {} })).toBeUndefined()
    expect(asModelContextRegistry({ modelContext: { registerTool: 'not a function' } })).toBeUndefined()
  })

  it('is undefined when modelContext itself is null', () => {
    expect(asModelContextRegistry({ modelContext: null })).toBeUndefined()
  })

  it('returns the registry when registerTool is a real function', () => {
    const modelContext = { registerTool: vi.fn() }

    expect(asModelContextRegistry({ modelContext })).toBe(modelContext)
  })
})

describe('registerModelContextTool', () => {
  it('does nothing when WebMCP is not present', async () => {
    await expect(registerModelContextTool({}, TOOL, new AbortController().signal)).resolves.toBeUndefined()
  })

  it('registers the tool with the given signal when WebMCP is present', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)
    const controller = new AbortController()

    await registerModelContextTool({ modelContext: { registerTool } }, TOOL, controller.signal)

    expect(registerTool).toHaveBeenCalledWith(TOOL, { signal: controller.signal })
  })

  it('never throws when registerTool itself rejects', async () => {
    const registerTool = vi.fn().mockRejectedValue(new Error('a tool with this name is already registered'))

    await expect(
      registerModelContextTool({ modelContext: { registerTool } }, TOOL, new AbortController().signal),
    ).resolves.toBeUndefined()
  })
})
