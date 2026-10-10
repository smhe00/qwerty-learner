/* eslint-env node */
/** Fail-closed server-side S2 write isolation based on immutable userId. */
export function isS2WriteAllowed(config, userId) {
  if (typeof config !== 'string' || typeof userId !== 'string' || !userId) return false
  const ids = config.split(',').map(item => item.trim()).filter(Boolean)
  return ids.length > 0 && !ids.includes('*') && ids.includes(userId)
}
