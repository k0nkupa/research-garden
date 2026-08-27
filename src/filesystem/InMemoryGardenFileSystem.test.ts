import { describeGardenFileSystemContract } from './contract'
import { InMemoryGardenFileSystem } from './InMemoryGardenFileSystem'

describeGardenFileSystemContract('InMemoryGardenFileSystem', (files) => {
  const fileSystem = new InMemoryGardenFileSystem(files, 'test-garden')
  return {
    fileSystem,
    revokePermission: () => fileSystem.revokePermission(),
    grantPermission: () => fileSystem.grantPermission(),
  }
})
