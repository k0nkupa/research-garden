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

    describe('deleting', () => {
      it('removes a file so it can no longer be read', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await fileSystem.delete(['branches', 'attention.md'])

        await expect(fileSystem.read(['branches', 'attention.md'])).rejects.toMatchObject({
          code: 'not-found',
        })
      })

      it('removes a deleted file from listing', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await fileSystem.delete(['branches', 'attention.md'])

        const found = await fileSystem.listFiles(['branches'])
        expect(found.map((path) => path.join('/'))).not.toContain('branches/attention.md')
      })

      it('resolves without error when nothing exists at that path', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await expect(fileSystem.delete(['branches', 'never-existed.md'])).resolves.toBeUndefined()
      })

      it('leaves every other file untouched', async () => {
        const { fileSystem } = setUp(sampleGarden)

        await fileSystem.delete(['branches', 'attention.md'])

        await expect(fileSystem.read(['roots', 'paper.md'])).resolves.toBe('# A paper\n')
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

        it(`refuses to delete through ${label}`, async () => {
          const { fileSystem } = setUp(sampleGarden)

          await expect(fileSystem.delete(path)).rejects.toMatchObject({ code: 'path-escape' })
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

      it('refuses to delete once permission has lapsed', async () => {
        const { fileSystem, revokePermission } = setUp(sampleGarden)
        revokePermission()

        await expect(fileSystem.delete(['branches', 'attention.md'])).rejects.toMatchObject({
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

/**
 * Extra behaviour only an adapter backed by a real folder can have: the folder
 * itself going away. The in-memory adapter has no such folder, so this is run
 * against the File System Access adapter alone.
 */
export function describeVanishingRepository(
  name: string,
  setUp: (files: Record<string, string>) => { fileSystem: GardenFileSystem; vanish(): void },
) {
  describe(`${name} notices its folder vanishing`, () => {
    const garden = { 'branches/attention.md': '# Attention\n' }

    it('reports a listing as not-found rather than as empty', async () => {
      const { fileSystem, vanish } = setUp(garden)
      vanish()

      await expect(fileSystem.listFiles(['branches'])).rejects.toMatchObject({
        code: 'not-found',
      })
    })

    it('reports a directory the Garden simply lacks as empty, not as missing', async () => {
      const { fileSystem } = setUp(garden)

      await expect(fileSystem.listFiles(['harvests'])).resolves.toEqual([])
    })
  })
}

/** Reading a file as bytes, which is how Attachments are read (ADR 0057). */
export function describeByteReading(
  name: string,
  setUp: (files: Record<string, string | Uint8Array>) => ContractSubject,
) {
  describe(`${name} reads bytes`, () => {
    const garden = { 'attachments/note.txt': 'hello' }

    /** Every byte value, including those no text encoding round-trips. */
    const binary = new Uint8Array(Array.from({ length: 256 }, (_, at) => at))

    it('returns binary bytes exactly as stored', async () => {
      const { fileSystem } = setUp({ 'attachments/photo.png': binary })

      const read = await fileSystem.readBytes(['attachments', 'photo.png'])
      expect([...read]).toEqual([...binary])
    })

    it('does not corrupt a byte that is not valid text', async () => {
      const { fileSystem } = setUp({ 'attachments/photo.png': new Uint8Array([0xff, 0xfe, 0x00]) })

      expect([...(await fileSystem.readBytes(['attachments', 'photo.png']))]).toEqual([
        0xff, 0xfe, 0x00,
      ])
    })

    it('reads the bytes of a file', async () => {
      const { fileSystem } = setUp(garden)

      const bytes = await fileSystem.readBytes(['attachments', 'note.txt'])
      expect(new TextDecoder().decode(bytes)).toBe('hello')
    })

    it('reports a missing file as not-found', async () => {
      const { fileSystem } = setUp(garden)

      await expect(fileSystem.readBytes(['attachments', 'absent.png'])).rejects.toMatchObject({
        code: 'not-found',
      })
    })

    it('refuses a path that leaves the Garden Repository', async () => {
      const { fileSystem } = setUp(garden)

      await expect(fileSystem.readBytes(['..', 'secrets.png'])).rejects.toMatchObject({
        code: 'path-escape',
      })
    })

    it('refuses once permission has lapsed', async () => {
      const { fileSystem, revokePermission } = setUp(garden)
      revokePermission()

      await expect(fileSystem.readBytes(['attachments', 'note.txt'])).rejects.toMatchObject({
        code: 'permission-denied',
      })
    })
  })
}
