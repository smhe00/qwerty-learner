/**
 * Stable, immutable identity for one completed typing/learning attempt.
 * 128-bit CSPRNG UUIDv4; no account, device identifier or learned word leaks.
 * Does not replace IndexedDB's numeric foreign-key ID.
 *
 * A pre-UUID record is LEGACY and cannot be silently deduplicated by
 * timestamp. Never invent an attemptId while importing an old V4 archive.
 */
export function newLearningAttemptId(): string {
  const secure = globalThis.crypto
  if (!secure?.getRandomValues) {
    throw new Error('Secure random generator unavailable: refusing ambiguous learning attempt identity')
  }
  if (secure.randomUUID) return secure.randomUUID()
  // Safe compatibility fallback for browsers with getRandomValues but no
  // randomUUID; RFC 4122 version/variant bits yield a standard UUID v4.
  const bytes = new Uint8Array(16)
  secure.getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

export function isLearningAttemptId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
