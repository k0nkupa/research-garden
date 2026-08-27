import { describeGardenFileSystemContract } from './contract'
import { FileSystemAccessGardenFileSystem } from './FileSystemAccessGardenFileSystem'
import { FakeDirectoryHandle } from './fakeDirectoryHandle'

// Running the shared contract against the shipping adapter — over a fake of the
// browser handle API — is what stops the in-memory adapter from drifting away
// from real behaviour. ADR 0064 still requires a real-browser acceptance run.
describeGardenFileSystemContract('FileSystemAccessGardenFileSystem', (files) => {
  const root = FakeDirectoryHandle.fromFiles(files, 'test-garden')
  return {
    fileSystem: new FileSystemAccessGardenFileSystem(root),
    revokePermission: () => root.setPermission('denied'),
    grantPermission: () => root.setPermission('granted'),
  }
})
