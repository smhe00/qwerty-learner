/**
 * S2 step 1: deterministic manual Sync V2 decision kernel.
 *
 * Does NOT read storage, invoke the network, mutate the active workspace or
 * start payload transfers. A future executor must recheck the cloud revision
 * at the point of a CAS push / before an authorized pull, and commit the
 * account-scoped local baseline only after a successful operation.
 *
 * Deliberately never accepts V1 cloud metadata as proof of V4 equality.
 */
import { WORKSPACE_V4_FORMAT } from './workspace-v4'
import type { WorkspaceIdentityV4 } from './workspace-v4'

export type SyncV2Local = {
  logicalFingerprint: string
  hasMeaningfulState: boolean
}

export type SyncV2RemoteMeta = {
  hasData: boolean
  revision: number
  logicalFingerprint: string | null
  clientFormatVersion: string | null
}

export type SyncV2Baseline = {
  accountId: string
  baseRevision: number
  logicalFingerprint: string
}

export type SyncV2Action = 'noop' | 'push' | 'pull' | 'conflict' | 'blocked'
export type SyncV2Reason =
  | 'identical'
  | 'empty-both'
  | 'local-changed'
  | 'remote-changed'
  | 'concurrent-edits'
  | 'unbound-local'
  | 'anonymous-workspace'
  | 'identity-mismatch'
  | 'invalid-local-state'
  | 'invalid-remote-metadata'
  | 'remote-format-unsupported'
  | 'remote-fingerprint-missing'
  | 'invalid-baseline'
  | 'baseline-owner-mismatch'
  | 'remote-revision-regressed'
  | 'remote-disappeared'
  | 'remote-changed-without-revision'

export type SyncV2Decision = {
  action: SyncV2Action
  reason: SyncV2Reason
  /** Metadata CAS base for a future push; not authorization to push by itself. */
  remoteRevision: number | null
  /** Only No-op is permitted to update a baseline without payload transport. */
  baselineOnly: boolean
}

type SyncV2Input = {
  activeWorkspace: WorkspaceIdentityV4
  authenticatedAccountId: string | null
  local: SyncV2Local
  remote: SyncV2RemoteMeta
  baseline: SyncV2Baseline | null
}

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)

function result(
  action: SyncV2Action,
  reason: SyncV2Reason,
  remoteRevision: number | null,
  baselineOnly = false,
): SyncV2Decision {
  return { action, reason, remoteRevision, baselineOnly }
}

/**
 * The ordinary button remains ONE Sync. Any conflict/blocked decision must
 * lead to an explicit non-destructive recovery state, never a silent overwrite.
 */
export function decideManualSyncV2(input: SyncV2Input): SyncV2Decision {
  const { activeWorkspace, authenticatedAccountId, local, remote, baseline } = input
  if (activeWorkspace.kind !== 'account') {
    return result('blocked', 'anonymous-workspace', null)
  }
  if (!activeWorkspace.accountId.trim() ||
      authenticatedAccountId !== activeWorkspace.accountId) {
    return result('blocked', 'identity-mismatch', null)
  }
  if (!isSha256(local.logicalFingerprint) ||
      typeof local.hasMeaningfulState !== 'boolean') {
    return result('blocked', 'invalid-local-state', null)
  }
  if (!Number.isSafeInteger(remote.revision) || remote.revision < 0 ||
      typeof remote.hasData !== 'boolean' ||
      (!remote.hasData && (remote.revision !== 0 || remote.logicalFingerprint !== null))) {
    return result('blocked', 'invalid-remote-metadata', null)
  }
  if (baseline !== null) {
    if (baseline.accountId !== activeWorkspace.accountId) {
      return result('blocked', 'baseline-owner-mismatch', null)
    }
    if (!Number.isSafeInteger(baseline.baseRevision) || baseline.baseRevision < 0 ||
        !isSha256(baseline.logicalFingerprint)) {
      return result('blocked', 'invalid-baseline', null)
    }
    if (remote.revision < baseline.baseRevision) {
      return result('blocked', 'remote-revision-regressed', remote.revision)
    }
  }
  if (!remote.hasData) {
    // A previously populated cloud record disappearing must not be treated as
    // permission to recreate the account or overwrite an unknown tombstone.
    if (baseline && baseline.baseRevision > 0) {
      return result('blocked', 'remote-disappeared', remote.revision)
    }
    if (!local.hasMeaningfulState) {
      return result('noop', 'empty-both', 0, true)
    }
    return result('push', 'local-changed', 0)
  }
  if (remote.clientFormatVersion !== WORKSPACE_V4_FORMAT) {
    return result('blocked', 'remote-format-unsupported', remote.revision)
  }
  if (!isSha256(remote.logicalFingerprint)) {
    return result('blocked', 'remote-fingerprint-missing', remote.revision)
  }

  // Canonical V4 equality takes precedence over stale metadata baselines.
  // This is the sole safe metadata-only no-op when remote has payload.
  if (local.logicalFingerprint === remote.logicalFingerprint) {
    return result('noop', 'identical', remote.revision, true)
  }

  if (baseline === null) {
    // A newly bound, truly empty local account replica may pull its own
    // existing cloud state. Any populated local workspace must be reconciled.
    return local.hasMeaningfulState
      ? result('conflict', 'unbound-local', remote.revision)
      : result('pull', 'remote-changed', remote.revision)
  }

  const localDirty = local.logicalFingerprint !== baseline.logicalFingerprint
  const remoteChanged = remote.revision !== baseline.baseRevision
  if (localDirty && remoteChanged) {
    return result('conflict', 'concurrent-edits', remote.revision)
  }
  if (localDirty) {
    return result('push', 'local-changed', remote.revision)
  }
  if (remoteChanged) {
    return result('pull', 'remote-changed', remote.revision)
  }
  // Same revision but a different cloud logical fingerprint violates the
  // server's immutable-revision contract: refuse both directions.
  return result('blocked', 'remote-changed-without-revision', remote.revision)
}
