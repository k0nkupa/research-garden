import { describe, expect, it } from 'vitest'
import { nestedLimbPath, type TreeNode } from './treeLayout'

const source: TreeNode = {
  id: 'branch-1', title: 'Thread', kind: 'branch', depth: 1,
  x: 0, y: -150, dormant: false, hasChildren: true, expanded: true,
}

function child(id: string, x: number): TreeNode {
  return {
    id, title: id, kind: 'claim_leaf', depth: 2, x, y: -270,
    dormant: false, hasChildren: false, expanded: false,
  }
}

describe('nested focused projection geometry', () => {
  it('is deterministic for the same node identity and hierarchy positions', () => {
    const target = child('claim-alpha', -90)
    expect(nestedLimbPath(source, target)).toBe(nestedLimbPath(source, target))
  })

  it('gives sibling limbs distinct seeded departure and curvature', () => {
    const paths = [
      nestedLimbPath(source, child('claim-alpha', -90)),
      nestedLimbPath(source, child('claim-beta', 0)),
      nestedLimbPath(source, child('claim-gamma', 90)),
    ]
    expect(new Set(paths).size).toBe(paths.length)
    expect(paths.every((path) => path.startsWith('M0,-150 C'))).toBe(true)
  })
})
