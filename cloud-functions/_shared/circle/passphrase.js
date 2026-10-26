/* eslint-env node */
/** Shared browser/server rules. Null means invalid; no locale-dependent case folding. */
export function normalizeCirclePassphrase(value) {
  if (typeof value !== 'string') return null
  const text = value.normalize('NFC').trim()
  if (Array.from(text).length < 2 || Array.from(text).length > 32 ||
      Array.from(text).some(c => { const n = c.codePointAt(0); return n < 32 || (n >= 127 && n <= 159) ||
        (n >= 0x200b && n <= 0x200f) || (n >= 0x202a && n <= 0x202e) || (n >= 0x2060 && n <= 0x206f) || n === 0xfeff })) return null
  return text
}
export const isLegacyCircleInvite = value => typeof value === 'string' && /^QC[23]-[a-f0-9]{24}-[a-f0-9]{32}$/.test(value)
