import { describe, expect, it } from 'vitest'
import { GardenFileSystemError, type GardenFileSystem } from './GardenFileSystem'

export interface ContractSubject {
  readonly fileSystem: GardenFileSystem
  /** Revoke the browser's permission, as happens when a tab is backgrounded. */
  revokePermission(): void
  /** Restore permission, as a successful re-prompt would. */
  grantPermission(): void
}

export interface ContractSetup {
  (files: Record<string, string>): ContractSubject
}

/**
 * The behaviour every filesystem adapter must share.
 *
 * Written once and run against each adapter, so the in-memory adapter used by
 * the rest of the unit suite cannot quietly diverge from the File System Access
 * adapter the product actually ships (ADR 0065).
 */
export function describeGardenFileSystemContract(name: string, setUp: ContractSetup) {
  describe(`${name} satisfies the Garden filesystem contract`, () => {
    const sampleGarden = {
      'branches/attention.md': '# Attention\n',
      'branches/nested/optimisers.md': '# Optimisers\n',
      'roots/paper.md': '# A paper\n',
    }

    describe('listing', () => {
      it('lists every file beneath a directory, recursively', async () => {
        const { fileSystem } = setUp(sampleGarden)

        const found = await fileSystem.listFiles(['branches'])

        expect(found.map((path) => path.join('/')).sort()).toEqual([
          'branches/attention.md',
          'branches/nested/optimisers.md',
        ])
      })

      it('lists a directory that does not exist as empty', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await expect(fileSystem.listFiles(['harvests'])).resolves.toEqual([])
      })

      it('does not list files from a sibling directory', async () => {
        const { fileSystem } = setUp(sampleGarden)

        const found = await fileSystem.listFiles(['roots'])

        expect(found.map((path) => path.join('/'))).toEqual(['roots/paper.md'])
      })
    })

    describe('reading', () => {
      it('reads a file it listed', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await expect(fileSystem.read(['branches', 'attention.md'])).resolves.toBe('# Attention\n')
      })

      it('reports a missing file as not-found', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await expect(fileSystem.read(['branches', 'absent.md'])).rejects.toMatchObject({
          code: 'not-found',
        })
      })

      it('reports reading a directory as not-a-file', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await expect(fileSystem.read(['branches'])).rejects.toMatchObject({
          code: 'not-a-file',
        })
      })
    })

    describe('writing', () => {
      it('writes a new file that can then be read back', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await fileSystem.write(['branches', 'new.md'], '# New\n')

        await expect(fileSystem.read(['branches', 'new.md'])).resolves.toBe('# New\n')
      })

      it('replaces an existing file completely rather than appending', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await fileSystem.write(['branches', 'attention.md'], 'replaced')

        await expect(fileSystem.read(['branches', 'attention.md'])).resolves.toBe('replaced')
      })

      it('creates missing intermediate directories', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await fileSystem.write(['harvests', 'deep', 'result.md'], 'grown')

        await expect(fileSystem.read(['harvests', 'deep', 'result.md'])).resolves.toBe('grown')
      })

      it('makes a written file visible to listing', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await fileSystem.write(['harvests', 'result.md'], 'grown')

        const found = await fileSystem.listFiles(['harvests'])
        expect(found.map((path) => path.join('/'))).toEqual(['harvests/result.md'])
      })
    })

    // ADR 0058: the selected folder is the boundary, and the port is where that
    // is enforced. No caller may reach outside it.
    describe('path safety', () => {
      const escapes = [
        { label: 'a parent traversal', path: ['branches', '..', '..', 'secrets.md'] },
        { label: 'a bare parent segment', path: ['..'] },
        { label: 'a current-directory segment', path: ['branches', '.', 'a.md'] },
        { label: 'an empty segment', path: ['branches', '', 'a.md'] },
        { label: 'an embedded separator', path: ['branches/../../etc/passwd'] },
        { label: 'a backslash separator', path: ['branches\\..\\secrets.md'] },
        { label: 'an empty path', path: [] },
      ]

      for (const { label, path } of escapes) {
        it(`refuses to read through ${label}`, async () => {
          const { fileSystem } = setUp(sampleGarden)

          await expect(fileSystem.read(path)).rejects.toMatchObject({ code: 'path-escape' })
        })

        it(`refuses to write through ${label}`, async () => {
          const { fileSystem } = setUp(sampleGarden)

          await expect(fileSystem.write(path, 'x')).rejects.toMatchObject({
            code: 'path-escape',
          })
        })
      }

      it('refuses to list through a parent traversal', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await expect(fileSystem.listFiles(['..'])).rejects.toMatchObject({
          code: 'path-escape',
        })
      })

      it('raises path escapes as a GardenFileSystemError', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await expect(fileSystem.read(['..'])).rejects.toBeInstanceOf(GardenFileSystemError)
      })
    })

    // A person can revoke folder access at any moment, and the product must
    // describe that rather than crash or half-finish an action.
    describe('permission', () => {
      it('reports permission as granted while the folder is accessible', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await expect(fileSystem.permission()).resolves.toBe('granted')
      })

      it('reports permission as denied once it has lapsed', async () => {
        const { fileSystem, revokePermission } = setUp(sampleGarden)
        revokePermission()

        await expect(fileSystem.permission()).resolves.toBe('denied')
      })

      it('refuses to read once permission has lapsed', async () => {
        const { fileSystem, revokePermission } = setUp(sampleGarden)
        revokePermission()

        await expect(fileSystem.read(['branches', 'attention.md'])).rejects.toMatchObject({
          code: 'permission-denied',
        })
      })

      it('refuses to list once permission has lapsed', async () => {
        const { fileSystem, revokePermission } = setUp(sampleGarden)
        revokePermission()

        await expect(fileSystem.listFiles(['branches'])).rejects.toMatchObject({
          code: 'permission-denied',
        })
      })

      it('refuses to write once permission has lapsed', async () => {
        const { fileSystem, revokePermission } = setUp(sampleGarden)
        revokePermission()

        await expect(fileSystem.write(['branches', 'a.md'], 'x')).rejects.toMatchObject({
          code: 'permission-denied',
        })
      })

      it('leaves a file unchanged when a write is refused for permission', async () => {
        const { fileSystem, revokePermission, grantPermission } = setUp(sampleGarden)
        revokePermission()

        await expect(fileSystem.write(['branches', 'attention.md'], 'x')).rejects.toThrow()

        grantPermission()
        await expect(fileSystem.read(['branches', 'attention.md'])).resolves.toBe('# Attention\n')
      })

      it('reads again after permission is restored', async () => {
        const { fileSystem, revokePermission, grantPermission } = setUp(sampleGarden)
        revokePermission()
        grantPermission()

        await expect(fileSystem.read(['branches', 'attention.md'])).resolves.toBe('# Attention\n')
      })

      it('reports the restored state from requestPermission', async () => {
        const { fileSystem, revokePermission, grantPermission } = setUp(sampleGarden)
        revokePermission()
        grantPermission()

        await expect(fileSystem.requestPermission()).resolves.toBe('granted')
      })
    })

    it('exposes a repository name for the interface', () => {
      const { fileSystem } = setUp(sampleGarden)

      expect(fileSystem.repositoryName).toBeTruthy()
    })
  })
}
