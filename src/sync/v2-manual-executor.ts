/**
 * S2-P2b manual Sync executor, intentionally NOT wired to application UI.
 *
 * All operations require a pre-mount, writer-quiescent, authenticated S1
 * account workspace. No cloud payload is transferred for metadata-only noop.
 * An immutable V4 full snapshot is captured ONCE after flushing writers.
 * Pull stages a verified target in the durable journal before destructive
 * restore; failed stages always require replay before app hydration.
 *
 * WARNING: only the guarded pre-mount adapter may provide these ports.
 * A normal mounted React button must navigate to that adapter, never call
 * this function while the app is live and can write RecordDB.
 */
import { preflightManualSyncV2 } from './v2-preflight'
import { verifyDownloadedWorkspaceV4 } from './v2-verify-remote'
import { assertRestorableWorkspaceV4, workspaceFingerprintV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import type { PullJournalPort } from './v2-pull-transaction'
import type { SyncV2Baseline } from './v2-policy'
import type { RemoteSnapshot, RemoteSyncMeta } from './types'

export type S2ExecutionResult =
  | { status: 'noop'; revision: number }
  | { status: 'pushed'; revision: number }
  | { status: 'pull-reload-required'; revision: number }
  | { status: 'blocked' | 'conflict'; reason: string }

export type SyncV2ExecutionPort = {
  accountId: string
  registryGeneration: number
  /** Caller proves and rechecks exclusive writer lease + immutable account. */
  assertQuiescentOwner(): Promise<void>
  flush(): Promise<void>
  capture(): Promise<WorkspaceSnapshotV4>
  readBaseline(): Promise<SyncV2Baseline | null>
  compareAndSwapBaseline(expected: SyncV2Baseline | null, next: SyncV2Baseline): Promise<void>
  getMeta(): Promise<RemoteSyncMeta>
  getSnapshot(): Promise<RemoteSnapshot>
  put(input: {
    baseRevision: number
    payloadBase64: string
    logicalFingerprint: string
    clientFormatVersion: 'qwerty-backup-v4'
  }): Promise<RemoteSyncMeta>
  /** Preserve pre-pull unsynced local state in isolated Vault before restore. */
  saveSource(snapshot: WorkspaceSnapshotV4): Promise<void>
  journal: PullJournalPort
}

function base(accountId: string, revision: number, hash: string): SyncV2Baseline {
  return { accountId, baseRevision: revision, logicalFingerprint: hash }
}
const SHA256 = /^[a-f0-9]{64}$/

export async function payloadV4(snapshot: WorkspaceSnapshotV4): Promise<{
  encoded: string
  checksum: string
}> {
  const pako = await import('pako')
  const compressed = pako.gzip(JSON.stringify(snapshot))
  const digest = await crypto.subtle.digest('SHA-256', compressed)
  const checksum = [...new Uint8Array(digest)]
    .map(c => c.toString(16).padStart(2, '0')).join('')
  const chunks: string[] = []
  for (let i = 0; i < compressed.length; i += 0x8000) {
    chunks.push(String.fromCharCode(...compressed.subarray(i, i + 0x8000)))
  }
  return { encoded: btoa(chunks.join('')), checksum }
}

function sameRemote(a: RemoteSyncMeta, b: RemoteSyncMeta): boolean {
  return a.revision === b.revision &&
    a.hasData === b.hasData &&
    a.logicalFingerprint === b.logicalFingerprint &&
    a.payloadSha256 === b.payloadSha256 &&
    a.clientFormatVersion === b.clientFormatVersion
}

/**
 * Both cloud and IDB are permitted IO, but no application UI is active.
 * Stale responses are fail-closed; caller must explicitly recover/refresh.
 */
export async function executeManualSyncV2(port: SyncV2ExecutionPort): Promise<S2ExecutionResult> {
  await port.assertQuiescentOwner()
  if (!port.accountId.trim() || !Number.isSafeInteger(port.registryGeneration) ||
      port.registryGeneration < 1) {
    throw new Error('S2 requires a valid isolated account workspace generation')
  }
  await port.flush()
  const local = await port.capture()
  assertRestorableWorkspaceV4(local)
  if (local.metadata.source.kind !== 'account' ||
      local.metadata.source.accountId !== port.accountId) {
    throw new Error('S2 working workspace immutable account mismatch')
  }
  const baseline = await port.readBaseline()
  const remote = await port.getMeta()
  const preflight = await preflightManualSyncV2(local, port.accountId, {
    ...remote, logicalFingerprint: remote.logicalFingerprint ?? null,
  }, baseline)
  const decision = preflight.decision
  if (decision.action === 'blocked' || decision.action === 'conflict') {
    return { status: decision.action, reason: decision.reason }
  }
  if (decision.action === 'noop') {
    // For an empty remote with no actual checkpoint, no durable revision
    // exists to adopt. Otherwise metadata-only rebase is safe only because
    // canonical local and cloud fingerprints were proven equal.
    if (remote.hasData) {
      await port.assertQuiescentOwner()
      await port.compareAndSwapBaseline(baseline,
        base(port.accountId, remote.revision, preflight.localFingerprint))
    }
    return { status: 'noop', revision: remote.revision }
  }
  if (decision.action === 'push') {
    const bytes = await payloadV4(local)
    await port.assertQuiescentOwner()
    const uploaded = await port.put({
      baseRevision: remote.revision,
      payloadBase64: bytes.encoded,
      logicalFingerprint: preflight.localFingerprint,
      clientFormatVersion: 'qwerty-backup-v4',
    })
    // Server upload may have committed even if a response was truncated.
    // Do not advance baseline without checking BOTH verified hashes;
    // next Sync will then converge via metadata-only noop.
    if (!uploaded.hasData || uploaded.revision !== remote.revision + 1 ||
        uploaded.clientFormatVersion !== 'qwerty-backup-v4' ||
        uploaded.logicalFingerprint !== preflight.localFingerprint ||
        !SHA256.test(uploaded.payloadSha256 || '') ||
        uploaded.payloadSha256 !== bytes.checksum) {
      throw new Error('S2 V4 Push response integrity or revision mismatch')
    }
    await port.assertQuiescentOwner()
    await port.compareAndSwapBaseline(baseline,
      base(port.accountId, uploaded.revision, preflight.localFingerprint))
    return { status: 'pushed', revision: uploaded.revision }
  }
  // Pull never selects an arbitrary older cloud revision after discovery.
  const cloud = await port.getSnapshot()
  const verified = await verifyDownloadedWorkspaceV4(port.accountId, remote, cloud)
  const confirmed = await port.getMeta()
  if (!sameRemote(remote, confirmed)) {
    throw new Error('S2 remote revision changed before Pull staging')
  }
  if (await workspaceFingerprintV4(verified) !== cloud.logicalFingerprint) {
    throw new Error('S2 verified cloud snapshot changed unexpectedly')
  }
  await port.assertQuiescentOwner()
  // Save current local state (including an unbound empty account) before
  // entering the non-atomic RecordDB restore windows.
  await port.saveSource(local)
  await port.assertQuiescentOwner()
  // Stage under the S1 owner lease, then force navigation. The existing S1
  // bootstrap will replay the durable snapshot BEFORE installing the
  // storage-writer guard and mounting any React/RecordDB writer.
  await port.journal.stage({
    version: 1, accountId: port.accountId,
    registryGeneration: port.registryGeneration,
    revision: cloud.revision,
    fingerprint: cloud.logicalFingerprint!,
    oldBaseline: baseline, snapshot: verified,
  })
  return { status: 'pull-reload-required', revision: cloud.revision }
}
