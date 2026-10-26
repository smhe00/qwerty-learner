/** A per-circle display label; never an identity or authorization key. */
export function normalizeCircleNickname(value) {
  if (typeof value !== 'string') return null
  const text = value.normalize('NFC').trim()
  const invalid = Array.from(text).some(character => {
    const n = character.codePointAt(0)
    return n < 32 || (n >= 127 && n <= 159) || (n >= 0x200b && n <= 0x200f) ||
      (n >= 0x202a && n <= 0x202e) || (n >= 0x2060 && n <= 0x206f) || n === 0xfeff
  })
  return Array.from(text).length > 32 || invalid ? null : text
}
