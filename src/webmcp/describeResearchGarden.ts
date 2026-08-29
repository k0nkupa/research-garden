import { registerModelContextTool, type ModelContextTool } from './modelContext'

/**
 * `describe_research_garden`: the one WebMCP tool exposed before a Garden is
 * open and before Agent Access is enabled (ADR 0035, ticket 17).
 *
 * Deliberately not filesystem-backed and deliberately never unregistered --
 * ADR 0035 requires it to always be exposed, so Connect/Disconnect (which
 * govern the tools ticket 18 onward will register) never touch it. Its own
 * result never claims Garden files are private in a way the rest of the
 * product doesn't hold to (ADR 0080): reading it should tell a host agent
 * what Research Garden is and how a person would connect it, not promise
 * something Connect ChatGPT's own disclosure would then contradict.
 */

export interface DescribeResearchGardenResult {
  readonly ok: true
  readonly data: {
    readonly name: string
    readonly summary: string
    readonly howToConnect: string
  }
}

const RESULT: DescribeResearchGardenResult = {
  ok: true,
  data: {
    name: 'Research Garden',
    summary:
      'Research Garden is a local-first Markdown research tool. A person owns their Garden ' +
      'Repository and can use the complete human interface without an account. Garden files ' +
      'stay on their device unless they enable Agent Access and a tool call returns selected ' +
      'metadata, snippets, or bodies to this agent.',
    howToConnect:
      'Ask the person to open or create a Garden, then choose Connect ChatGPT in the workspace. ' +
      'Read and write tools become available only after they see and accept that one disclosure, ' +
      'for the current browser session only -- they can disconnect at any time.',
  },
}

export const DESCRIBE_RESEARCH_GARDEN_TOOL: ModelContextTool = {
  name: 'describe_research_garden',
  description: 'Describes Research Garden and how to gain access to its other tools.',
  annotations: { readOnlyHint: true },
  async execute() {
    return RESULT
  },
}

export async function registerDescribeResearchGardenTool(navigator: unknown, signal: AbortSignal): Promise<void> {
  await registerModelContextTool(navigator, DESCRIBE_RESEARCH_GARDEN_TOOL, signal)
}
