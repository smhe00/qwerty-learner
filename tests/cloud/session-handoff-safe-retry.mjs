/* eslint-env node */
// Qualification transport only. Unknown responses and thrown network errors are
// NEVER replayed. The sole accepted code is emitted before putSyncV4Binary.
export async function guardedPrewriteRetry({ send, verifyUnchanged,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onRetry = () => {} }) {
  if (typeof send !== 'function' || typeof verifyUnchanged !== 'function') throw new Error('Invalid retry contract')
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = await send()
    if (result.status !== 503 || result.data?.error !== 'v4_direct_body_read_failed' ||
        result.guarded !== 'account-handoff-blob-fixtures-v1' || attempt === 3) return result
    if (await verifyUnchanged() !== true) throw new Error('Pre-write retry cloud evidence changed or unavailable')
    onRetry(attempt)
    await sleep(attempt * 500)
  }
  throw new Error('Unreachable retry state')
}
