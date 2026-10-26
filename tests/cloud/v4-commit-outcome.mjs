/* eslint-env node */
// Only a full pinned readback plus a stable metadata recheck proves a lost commit.
// An unchanged revision is NOT proof that a timed-out server operation stopped.
export async function reconcileUnknownV4Commit({ expected, readMeta, verifyPinned,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxChecks = 8, intervalMs = 5000 }) {
  if (!Number.isSafeInteger(maxChecks) || maxChecks < 1 || maxChecks > 24) throw Error('Invalid read-only check bound')
  const matches = meta => meta?.hasData === true && meta.revision === expected.baseRevision + 1 &&
    meta.clientFormatVersion === 'qwerty-backup-v4' && meta.storageEncoding === 'binary' &&
    meta.logicalFingerprint === expected.logicalFingerprint && meta.payloadSha256 === expected.payloadSha256
  let observed = 'read-unavailable'
  for (let check = 1; check <= maxChecks; check++) {
    try {
      const meta = await readMeta()
      if (matches(meta)) {
        // Caller validates every byte and the account-scoped V4 logical digest.
        if (await verifyPinned(meta) !== true) return { status: 'readback-mismatch', checks: check }
        const confirmed = await readMeta()
        if (matches(confirmed)) return { status: 'committed', checks: check, revision: confirmed.revision }
        return { status: 'different-revision', checks: check }
      }
      if (meta?.revision !== expected.baseRevision) return { status: 'different-revision', checks: check }
      observed = 'not-observed'
    } catch { observed = 'read-unavailable' }
    if (check < maxChecks) await sleep(intervalMs)
  }
  return { status: observed, checks: maxChecks }
}
