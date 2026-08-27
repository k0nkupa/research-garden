/**
 * Content hashing.
 *
 * One implementation, because several things depend on two hashes agreeing:
 * the Garden Revision that says whether held results are current (ADR 0036), a
 * Root's record of exactly what was captured (ADR 0029), and the pre-write and
 * post-write checks that make a canonical write verifiable (ADR 0055).
 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The form a Root records, so the algorithm travels with the value. */
export async function contentHash(text: string): Promise<string> {
  return `sha256:${await sha256Hex(text)}`
}
