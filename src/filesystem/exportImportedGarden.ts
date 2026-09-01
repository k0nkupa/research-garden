import type { ImportedGardenSnapshot } from './ImportedGardenFileSystem'
import { normalizedGardenPathKey } from './GardenFileSystem'

const encoder = new TextEncoder()
const crc32 = (bytes: Uint8Array) => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)) } return (crc ^ 0xffffffff) >>> 0 }
const u16 = (value: number) => Uint8Array.of(value & 255, (value >>> 8) & 255)
const u32 = (value: number) => Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255)
const join = (parts: readonly Uint8Array[]) => { const size = parts.reduce((sum, part) => sum + part.length, 0); const result = new Uint8Array(size); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length } return result }

/** Generates a standards-compliant, uncompressed ZIP without serializing browser handles or session state. */
export function exportImportedGardenZip(snapshot: ImportedGardenSnapshot): Uint8Array {
  const locals: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0
  const exportedPathKeys = new Set<string>()
  for (const [path, bytes] of Object.entries(snapshot.files).sort(([a], [b]) => a.localeCompare(b))) {
    const pathKey = normalizedGardenPathKey(path.split('/'))
    if (exportedPathKeys.has(pathKey)) throw new Error('Duplicate exported path')
    exportedPathKeys.add(pathKey)
    const name = encoder.encode(path); const checksum = crc32(bytes)
    const local = join([u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(checksum), u32(bytes.length), u32(bytes.length), u16(name.length), u16(0), name, bytes])
    locals.push(local)
    central.push(join([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(checksum), u32(bytes.length), u32(bytes.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]))
    offset += local.length
  }
  const body = join([...locals, ...central])
  return join([body, u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(central.reduce((sum, entry) => sum + entry.length, 0)), u32(locals.reduce((sum, entry) => sum + entry.length, 0)), u16(0)])
}
