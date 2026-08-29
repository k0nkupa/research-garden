import type { GardenIndex } from '../domain/index/gardenIndex'

/** A short, content-free summary suitable for action errors. */
export function diagnosticMessageForItem(index: GardenIndex, itemId: string): string | undefined {
  const diagnostic = index.diagnostics.find((entry) => entry.itemId === itemId)
  return diagnostic?.problems.map((problem) => `${problem.field} ${problem.message}`).join('; ')
}
