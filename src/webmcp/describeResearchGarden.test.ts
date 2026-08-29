import { describe, expect, it, vi } from 'vitest'
import { DESCRIBE_RESEARCH_GARDEN_TOOL, registerDescribeResearchGardenTool } from './describeResearchGarden'

describe('the describe_research_garden tool', () => {
  it('is named describe_research_garden', () => {
    expect(DESCRIBE_RESEARCH_GARDEN_TOOL.name).toBe('describe_research_garden')
  })

  it('is marked read-only, since it never touches a filesystem', () => {
    expect(DESCRIBE_RESEARCH_GARDEN_TOOL.annotations?.readOnlyHint).toBe(true)
  })

  it('does not claim Garden files never leave the device (ADR 0080)', async () => {
    const result = (await DESCRIBE_RESEARCH_GARDEN_TOOL.execute({}, { signal: new AbortController().signal })) as {
      data: { summary: string }
    }

    expect(result.data.summary).not.toMatch(/never leaves?( the)? device/i)
    expect(result.data.summary).not.toMatch(/never uploaded|fully private|completely private/i)
  })

  it('explains how a host agent would gain access', async () => {
    const result = (await DESCRIBE_RESEARCH_GARDEN_TOOL.execute({}, { signal: new AbortController().signal })) as {
      data: { howToConnect: string }
    }

    expect(result.data.howToConnect).toMatch(/connect chatgpt/i)
  })
})

describe('registerDescribeResearchGardenTool', () => {
  it('registers under the exact name describe_research_garden', async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined)

    await registerDescribeResearchGardenTool({ modelContext: { registerTool } }, new AbortController().signal)

    expect(registerTool).toHaveBeenCalledTimes(1)
    const [registeredTool] = registerTool.mock.calls[0] as [{ name: string }]
    expect(registeredTool.name).toBe('describe_research_garden')
  })

  it('does nothing when WebMCP is not present', async () => {
    await expect(
      registerDescribeResearchGardenTool({}, new AbortController().signal),
    ).resolves.toBeUndefined()
  })
})
