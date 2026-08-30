/**
 * A small browser-serializable File System Access fixture.
 *
 * The acceptance suites need the same picker boundary in jsdom and Chromium,
 * while the application still exercises its real FileSystemAccess adapter.
 * Keeping the fixture as one plain-data installer avoids two subtly different
 * fake directory implementations drifting apart.
 */
export type FixtureFile = string

export interface FixtureDirectory {
  readonly kind: 'directory'
  readonly name: string
  readonly files: Record<string, FixtureFile>
  readonly directories: Record<string, FixtureDirectory>
}

export function installFixtureDirectoryPicker(
  target: object,
  files: Record<string, FixtureFile> = {},
  name = 'fixture-garden',
): FixtureDirectory {
  const root: FixtureDirectory = {
    kind: 'directory',
    name,
    files: {},
    directories: {},
  }

  for (const [path, contents] of Object.entries(files)) {
    const segments = path.split('/')
    const fileName = segments.pop()
    if (!fileName) continue
    let directory = root
    for (const segment of segments) {
      const existing = directory.directories[segment]
      if (existing) {
        directory = existing
        continue
      }
      const child: FixtureDirectory = {
        kind: 'directory',
        name: segment,
        files: {},
        directories: {},
      }
      directory.directories[segment] = child
      directory = child
    }
    directory.files[fileName] = contents
  }

  const fileHandle = (directory: FixtureDirectory, fileName: string) => ({
    kind: 'file' as const,
    name: fileName,
    async getFile() {
      const value = directory.files[fileName] ?? ''
      return {
        text: async () => value,
        arrayBuffer: async () => new TextEncoder().encode(value).buffer,
      }
    },
    async createWritable() {
      directory.files[fileName] = ''
      return {
        write: async (data: string) => {
          directory.files[fileName] = (directory.files[fileName] ?? '') + data
        },
        close: async () => {},
      }
    },
  })

  const directoryHandle = (directory: FixtureDirectory): any => ({
    kind: 'directory' as const,
    name: directory.name,
    async queryPermission() { return 'granted' },
    async requestPermission() { return 'granted' },
    async *entries() {
      for (const fileName of Object.keys(directory.files)) yield [fileName, fileHandle(directory, fileName)]
      for (const directoryName of Object.keys(directory.directories)) {
        yield [directoryName, directoryHandle(directory.directories[directoryName]!)]
      }
    },
    async getDirectoryHandle(directoryName: string, options?: { create?: boolean }) {
      if (directoryName in directory.files) throw new DOMException('TypeMismatchError', 'TypeMismatchError')
      const existing = directory.directories[directoryName]
      if (existing) return directoryHandle(existing)
      if (!options?.create) throw new DOMException('NotFoundError', 'NotFoundError')
      const created: FixtureDirectory = { kind: 'directory', name: directoryName, files: {}, directories: {} }
      directory.directories[directoryName] = created
      return directoryHandle(created)
    },
    async getFileHandle(fileName: string, options?: { create?: boolean }) {
      if (fileName in directory.directories) throw new DOMException('TypeMismatchError', 'TypeMismatchError')
      if (!(fileName in directory.files)) {
        if (!options?.create) throw new DOMException('NotFoundError', 'NotFoundError')
        directory.files[fileName] = ''
      }
      return fileHandle(directory, fileName)
    },
    async removeEntry(entryName: string) {
      if (!(entryName in directory.files) && !(entryName in directory.directories)) {
        throw new DOMException('NotFoundError', 'NotFoundError')
      }
      delete directory.files[entryName]
      delete directory.directories[entryName]
    },
  })

  Object.defineProperty(target, 'showDirectoryPicker', {
    configurable: true,
    value: async () => directoryHandle(root),
  })
  Object.defineProperty(target, '__researchGardenFixture', {
    configurable: true,
    value: root,
  })
  return root
}

/** Returns an init-script with the same fixture implementation for Playwright. */
export function fixtureDirectoryPickerInitScript(
  files: Record<string, FixtureFile> = {},
  name = 'fixture-garden',
): string {
  return `(${installFixtureDirectoryPicker.toString()})(window, ${JSON.stringify(files)}, ${JSON.stringify(name)})`
}
