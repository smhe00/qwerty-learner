/**
 * M2.7 safe-subset full V4 fast-forward candidate, READ-ONLY.
 * The caller must authenticate the actual shared ancestor independently.
 * Matching a supplied SHA is NOT proof that both devices checked out that
 * ancestor, or that an eventually-consistent device listing is complete.
 *
 * Only one-side-changed or identical V4 is admissible. Two divergent heads
 * need the separate six-table merge and replay protocol. This returns a full
 * V4 candidate but grants NO M4 staging, IDB, or cloud write authority.
 */
import {
  assertRestorableWorkspaceV4,
  REQUIRED_RESTORABLE_V4_TABLES,
  workspaceFingerprintV4,
} from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'

const SHA = /^[0-9a-f]{64}$/
export type FullV4FastForwardPreview =
  | { status: 'blocked'; reason: string; publishReady: false;
      convergenceComplete: false }
  | { status: 'projected';
      reason: 'pinned-full-v4-fast-forward-preview-only';
      publishReady: false; convergenceComplete: false;
      selected: 'local' | 'remote' | 'identical';
      candidate: WorkspaceSnapshotV4;
      ancestorFingerprint: string;
      localFingerprint: string;
      remoteFingerprint: string }

function blocked(reason: string): FullV4FastForwardPreview {
  return { status: 'blocked', reason, publishReady: false,
    convergenceComplete: false }
}

function assertIdentity(snapshot: WorkspaceSnapshotV4, accountId: string): void {
  try {
    assertRestorableWorkspaceV4(snapshot)
  } catch (error) {
    if (error instanceof Error &&
        error.message.includes('missing or duplicate durable tables')) {
      throw new Error('ancestor-incomplete-six-table-export')
    }
    throw error
  }
  if (snapshot.metadata.source.kind !== 'account' ||
      snapshot.metadata.source.accountId !== accountId) {
    throw new Error('ancestor-workspace-account-mismatch')
  }
  // A manifest-only archive could clear all durable rows on restore.
  const envelope = snapshot.workspaceData.database as {
    data: {
      databaseName?: string
      databaseVersion?: number
      tables: Array<{ name: string; schema: string }>
      data: Array<{ tableName: string; rows: unknown[] }>
    }
  }
  if (!envelope.data.databaseName ||
      !Number.isSafeInteger(envelope.data.databaseVersion) ||
      Number(envelope.data.databaseVersion) < 1) {
    throw new Error('ancestor-invalid-dexie-layout')
  }
  const manifest = new Map(envelope.data.tables.map(row =>
    [row.name, row.schema]))
  const content = new Map(envelope.data.data.map(row =>
    [row.tableName, row.rows]))
  if (envelope.data.tables.some(row =>
    typeof row.name !== 'string' || !row.name ||
    typeof row.schema !== 'string') ||
      manifest.size !== envelope.data.tables.length ||
      content.size !== envelope.data.data.length ||
      REQUIRED_RESTORABLE_V4_TABLES.some(name =>
        !manifest.has(name) || !content.has(name))) {
    throw new Error('ancestor-incomplete-six-table-export')
  }
}

function schemaKey(snapshot: WorkspaceSnapshotV4): string {
  const database = snapshot.workspaceData.database as {
    formatName: string
    formatVersion: number
    data: { databaseName: string; databaseVersion: number;
      tables: Array<{ name: string; schema: string }> }
  }
  return JSON.stringify([
    database.formatName, database.formatVersion,
    database.data.databaseName, database.data.databaseVersion,
    [...database.data.tables].map(row => [row.name, row.schema])
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0),
  ])
}

/**
 * Exact three-way fast-forward only; not a general six-table merge.
 * Only an independently authenticated common ancestor can later make the
 * resulting candidate eligible for a separate write-capable admission gate.
 */
export async function inspectPinnedV4FastForward(input: {
  accountId: string
  pinnedAncestorFingerprint: string
  ancestor: WorkspaceSnapshotV4
  local: WorkspaceSnapshotV4
  remote: WorkspaceSnapshotV4
}): Promise<FullV4FastForwardPreview> {
  try {
    if (!input.accountId || input.accountId.trim() !== input.accountId ||
        !SHA.test(input.pinnedAncestorFingerprint)) {
      return blocked('ancestor-pin-invalid')
    }
    for (const snapshot of [input.ancestor, input.local, input.remote]) {
      assertIdentity(snapshot, input.accountId)
    }
    const layout = schemaKey(input.ancestor)
    if (schemaKey(input.local) !== layout ||
        schemaKey(input.remote) !== layout) {
      return blocked('ancestor-dexie-schema-divergence')
    }
    const [ancestorFingerprint, localFingerprint, remoteFingerprint] =
      await Promise.all([
        workspaceFingerprintV4(input.ancestor),
        workspaceFingerprintV4(input.local),
        workspaceFingerprintV4(input.remote),
      ])
    if (ancestorFingerprint !== input.pinnedAncestorFingerprint) {
      return blocked('ancestor-pinned-fingerprint-mismatch')
    }
    const localChanged = localFingerprint !== ancestorFingerprint
    const remoteChanged = remoteFingerprint !== ancestorFingerprint
    if (localChanged && remoteChanged &&
        localFingerprint !== remoteFingerprint) {
      return blocked('both-devices-changed-requires-six-table-merge')
    }
    let selected: 'local' | 'remote' | 'identical'
    let snapshot: WorkspaceSnapshotV4
    if (localFingerprint === remoteFingerprint) {
      selected = 'identical'
      snapshot = input.local
    } else if (!localChanged) {
      selected = 'remote'
      snapshot = input.remote
    } else {
      selected = 'local'
      snapshot = input.local
    }
    return { status: 'projected',
      reason: 'pinned-full-v4-fast-forward-preview-only',
      publishReady: false, convergenceComplete: false,
      selected, candidate: structuredClone(snapshot),
      ancestorFingerprint, localFingerprint, remoteFingerprint }
  } catch (error) {
    return blocked(error instanceof Error ? error.message : 'ancestor-v4-invalid')
  }
}
