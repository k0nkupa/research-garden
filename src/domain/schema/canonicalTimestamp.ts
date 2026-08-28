/**
 * The canonical timestamp format every write uses.
 *
 * ADR 0077: `created_at` and `updated_at` are ISO 8601 UTC. `Date#toISOString`
 * already produces UTC, but always with millisecond precision (`.123Z`); this
 * strips it down to whole seconds so every canonical timestamp this build
 * writes has one consistent shape, matching what `createGarden` and
 * `editItem` both need and previously spelled out separately.
 */
export function nowAsCanonicalTimestamp(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z')
}
