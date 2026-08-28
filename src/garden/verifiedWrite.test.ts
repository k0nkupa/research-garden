import { describe, expect, it } from 'vitest'
import { contentHash } from '../domain/hash'
import { InMemoryGardenFileSystem } from '../filesystem/InMemoryGardenFileSystem'
import { writeAndVerify } from './verifiedWrite'

const BRANCH = 'branch_01HQ8X2K3M4N5P6Q7R8S9T0V1W'

const validText = `---
schema_version: 1
id: ${BRANCH}
kind: branch
title: Attention mechanisms
state: active
created_at: 2026-08-01T10:00:00Z
updated_at: 2026-08-01T10:00:00Z
---

Everything I am collecting about attention.
`

describe('a write that reads back exactly what was written', () => {
  it('reports verified with the reread text', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    const result = await writeAndVerify(fileSystem, ['branches', 'a.md'], validText)

    expect(result).toMatchObject({ kind: 'verified', text: validText })
  })

  it('reports the confirmed content hash', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    const result = await writeAndVerify(fileSystem, ['branches', 'a.md'], validText)

    if (result.kind !== 'verified') throw new Error('expected verified')
    expect(result.hash).toBe(await contentHash(validText))
  })

  it('reports the validated item', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    const result = await writeAndVerify(fileSystem, ['branches', 'a.md'], validText)

    if (result.kind !== 'verified') throw new Error('expected verified')
    expect(result.item.id).toBe(BRANCH)
  })

  it('actually wrote the file, not merely reported success', async () => {
    const fileSystem = new InMemoryGardenFileSystem({}, 'my-garden')

    await writeAndVerify(fileSystem, ['branches', 'a.md'], validText)

    expect(fileSystem.snapshot()['branches/a.md']).toBe(validText)
  })
})

describe('a write that reads back something that no longer parses', () => {
  it('is reported as a failure, not a success', async () => {
    // A filesystem that lies about what it wrote: this is exactly the case a
    // reread-and-confirm step exists to catch, which a plain "write resolved"
    // check could never see.
    class LyingFileSystem extends InMemoryGardenFileSystem {
      override async read(): Promise<string> {
        return 'not a Garden document at all\n'
      }
    }

    const result = await writeAndVerify(new LyingFileSystem({}, 'lying'), ['branches', 'a.md'], validText)

    expect(result.kind).toBe('verification-failed')
  })
})

describe('a write that reads back something that no longer validates', () => {
  it('is reported as a failure', async () => {
    class LyingFileSystem extends InMemoryGardenFileSystem {
      override async read(): Promise<string> {
        return validText.replace('state: active', '')
      }
    }

    const result = await writeAndVerify(new LyingFileSystem({}, 'lying'), ['branches', 'a.md'], validText)

    expect(result.kind).toBe('verification-failed')
    if (result.kind === 'verification-failed') {
      expect(result.message).toMatch(/no longer validates/)
    }
  })
})

describe('a write whose reread hash does not match what was intended', () => {
  it('is reported as a failure even though parsing and validation both succeed', async () => {
    // A subtly different but still-valid document: parsing and validating alone
    // would call this success. Only the hash check catches it.
    const alteredButValid = validText.replace('Everything I am collecting', 'Something else entirely')

    class DriftingFileSystem extends InMemoryGardenFileSystem {
      override async read(): Promise<string> {
        return alteredButValid
      }
    }

    const result = await writeAndVerify(new DriftingFileSystem({}, 'drifting'), ['branches', 'a.md'], validText)

    expect(result.kind).toBe('verification-failed')
    if (result.kind === 'verification-failed') {
      expect(result.message).toMatch(/does not match/)
    }
  })
})
