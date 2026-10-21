/**
 * M2.12 conservative three-way, COMPLETE V4 merge candidate (READ ONLY).
 *
 * No IDB, S1 vault, cloud, or M4 writes. Only call after a separately
 * authenticated same-account common ancestor has been established.
 *
 * The six Dexie tables AND daily-session runtime are one inseparable unit:
 * never combine review state/session cursor from one device with WordRecords
 * from another. Both branches changing that unit differently blocks; it
 * requires the separate immutable-attempt/FSRS replay and session arbitration.
 * Independent preferences may be merged key-by-key. Navigation is atomic.
 *
 * Even a valid V4 candidate is NOT proof of all other device heads, a cloud
 * write lease or a safe full-account publication. No ordinary UI calls this.
 */
import { inspectPinnedV4FastForward } from './v4-fast-forward-preview'
import {
  assertRestorableWorkspaceV4,
  canonicalWorkspaceData,
  stableWorkspaceJson,
  workspaceFingerprintV4,
} from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'

type Side = 'ancestor' | 'local' | 'remote' | 'identical'
export type ConservativeV4MergePreview =
  | { status: 'blocked'; reason: string; publishReady: false;
      convergenceComplete: false }
  | { status: 'projected'; reason: 'three-way-v4-conservative-preview-only';
      publishReady: false; convergenceComplete: false;
      candidate: WorkspaceSnapshotV4; candidateFingerprint: string;
      tableSource: Side; navigationSource: Side;
      settingsSources: Record<string, Side>;
      /** No device completess or automatic restore authorization. */
      needsAuthenticatedPublication: true }

function denied(reason: string): ConservativeV4MergePreview {
  return { status: 'blocked', reason, publishReady: false,
    convergenceComplete: false }
}
function choose<T>(base: T, local: T, remote: T): { value: T; source: Side } | null {
  const a = stableWorkspaceJson(base)
  const l = stableWorkspaceJson(local)
  const r = stableWorkspaceJson(remote)
  if (l === r) return { value: local, source: 'identical' }
  if (l === a) return { value: remote, source: 'remote' }
  if (r === a) return { value: local, source: 'local' }
  return null
}
function learningUnit(snapshot: WorkspaceSnapshotV4): unknown {
  const canonical = canonicalWorkspaceData(snapshot.workspaceData) as {
    database: unknown
  }
  return { database: canonical.database,
    dailySessions: snapshot.workspaceData.learnRuntime.dailySessions }
}
function settingValue(values: Record<string, unknown>, name: string): unknown {
  const present = Object.prototype.hasOwnProperty.call(values, name)
  return { present, value: present ? values[name] : null }
}

/** Return a detached full V4 candidate, never a write-capable command. */
export async function previewConservativeThreeWayV4(input: {
  accountId: string
  pinnedAncestorFingerprint: string
  ancestor: WorkspaceSnapshotV4
  local: WorkspaceSnapshotV4
  remote: WorkspaceSnapshotV4
}): Promise<ConservativeV4MergePreview> {
  try {
    // Reuse full account, six-table payload, schema, and true SHA checks.
    const ff = await inspectPinnedV4FastForward(input)
    if (ff.status === 'blocked' &&
        ff.reason !== 'both-devices-changed-requires-six-table-merge') {
      return denied(ff.reason)
    }
    // Full V4 fast-forward is already safe as a *candidate*, but still use
    // the same deterministic three-way composition path.
    const a = input.ancestor.workspaceData
    const l = input.local.workspaceData
    const r = input.remote.workspaceData
    const tables = choose(
      learningUnit(input.ancestor), learningUnit(input.local),
      learningUnit(input.remote),
    )
    if (!tables) return denied('both-devices-changed-learning-unit-requires-fsrs-replay')
    const navigation = choose(a.navigation, l.navigation, r.navigation)
    if (!navigation) return denied('both-devices-changed-navigation')
    const names = [...new Set([
      ...Object.keys(a.settings.values),
      ...Object.keys(l.settings.values),
      ...Object.keys(r.settings.values),
    ])].sort()
    const settingsSources: Record<string, Side> = {}
    const mergedSettings: Record<string, unknown> = {}
    for (const name of names) {
      const value = choose(
        settingValue(a.settings.values, name),
        settingValue(l.settings.values, name),
        settingValue(r.settings.values, name),
      )
      if (!value) return denied('divergent-setting:' + name)
      settingsSources[name] = value.source
      const picked = value.value as { present: boolean; value: unknown }
      if (picked.present) mergedSettings[name] = picked.value
    }
    const pickedTables = tables.source === 'remote' ? r :
      tables.source === 'local' || tables.source === 'identical' ? l : a
    const pickedNavigation = navigation.value
    const candidate = structuredClone(input.ancestor)
    candidate.workspaceData.database = structuredClone(pickedTables.database)
    candidate.workspaceData.learnRuntime = structuredClone(pickedTables.learnRuntime)
    candidate.workspaceData.settings = {
      version: 1, values: structuredClone(mergedSettings),
    }
    candidate.workspaceData.navigation = structuredClone(pickedNavigation)
    assertRestorableWorkspaceV4(candidate)
    return {
      status: 'projected',
      reason: 'three-way-v4-conservative-preview-only',
      publishReady: false, convergenceComplete: false,
      candidate, candidateFingerprint: await workspaceFingerprintV4(candidate),
      tableSource: tables.source, navigationSource: navigation.source,
      settingsSources, needsAuthenticatedPublication: true,
    }
  } catch (error) {
    return denied('three-way-v4-invalid:' +
      (error instanceof Error ? error.message : 'unknown'))
  }
}
