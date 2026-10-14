/**
 * Read-only, fail-closed attempt identity classification for future Sync V4
 * reconciliation. It neither merges Dexie tables nor authorizes a cloud
 * write. This deliberately excludes FSRS, session and achievement merging.
 */
import { isLearningAttemptId } from '@/utils/db/attempt-identity'
import type { IWordRecord } from '@/utils/db/record'
import { stableWorkspaceJson } from './workspace-v4'

export type AttemptIdentityPreflight = {
  /** Necessary identity gate, NOT permission to perform a full V4 merge. */
  safeEventIdentity: boolean
  localOnly: number
  remoteOnly: number
  shared: number
  anchoredLegacy: number
  legacyUnverified: number
  identityConflicts: number
  perDictionary: Record<string, {
    localOnly: number
    remoteOnly: number
    shared: number
  }>
}

function immutableEvidence(record: IWordRecord): string {
  // Numeric primary keys are workspace-local. These derived snapshots may
  // legitimately differ for the same attempt after local scheduler replay.
  const { id: _id, fsrsShadow: _shadow, reviewPolicyShadow: _proposal, ...evidence } = record
  return stableWorkspaceJson(evidence)
}

function referenceRecord(record: IWordRecord): string {
  const { attemptId: _uuid, ...legacy } = record
  return immutableEvidence(legacy)
}

/** Safe only for a VERIFIED common ancestor snapshot, not an inferred one. */
export function preflightAttemptIdentity(input: {
  local: readonly IWordRecord[]
  remote: readonly IWordRecord[]
  commonAncestor?: readonly IWordRecord[]
}): AttemptIdentityPreflight {
  const perDictionary: AttemptIdentityPreflight['perDictionary'] = {}
  const group = (dict: string) =>
    perDictionary[dict] ??= { localOnly: 0, remoteOnly: 0, shared: 0 }

  let identityConflicts = 0
  let legacyUnverified = 0
  let anchoredLegacy = 0
  let shared = 0
  let localOnly = 0
  let remoteOnly = 0

  const keyed = (rows: readonly IWordRecord[]) => {
    const map = new Map<string, IWordRecord>()
    const legacy = new Map<number, IWordRecord>()
    for (const record of rows) {
      if (record.attemptId !== undefined) {
        if (!isLearningAttemptId(record.attemptId) ||
            map.has(record.attemptId)) {
          identityConflicts++
        } else {
          map.set(record.attemptId, record)
        }
      } else if (record.id === undefined || !Number.isSafeInteger(record.id) ||
                 record.id <= 0 || legacy.has(record.id)) {
        // A row with invalid numeric primary key cannot be anchored.
        legacyUnverified++
      } else {
        legacy.set(record.id, record)
      }
    }
    return { map, legacy }
  }

  const a = keyed(input.local)
  const b = keyed(input.remote)
  const uuids = new Set([...a.map.keys(), ...b.map.keys()])
  for (const uuid of uuids) {
    const left = a.map.get(uuid)
    const right = b.map.get(uuid)
    if (left && right) {
      if (immutableEvidence(left) !== immutableEvidence(right)) {
        identityConflicts++
      } else {
        shared++
        group(left.dict).shared++
      }
    } else if (left) {
      localOnly++
      group(left.dict).localOnly++
    } else if (right) {
      remoteOnly++
      group(right.dict).remoteOnly++
    }
  }

  // Only a cryptographically verified common-ancestor V4 snapshot can prove
  // that two equal legacy numeric IDs refer to the same historical attempt.
  // A timestamp/word/result equality (or a matching local numeric ID) alone
  // is not sufficient.
  const old = input.commonAncestor ? keyed(input.commonAncestor).legacy : null
  const legacyKeys = new Set([...a.legacy.keys(), ...b.legacy.keys(),
    ...(old?.keys() ?? [])])
  for (const id of legacyKeys) {
    const ancestor = old?.get(id)
    const left = a.legacy.get(id)
    const right = b.legacy.get(id)
    if (ancestor && left && right &&
        referenceRecord(ancestor) === referenceRecord(left) &&
        referenceRecord(ancestor) === referenceRecord(right)) {
      anchoredLegacy++
    } else {
      legacyUnverified++
    }
  }

  return {
    safeEventIdentity: identityConflicts === 0 && legacyUnverified === 0,
    localOnly, remoteOnly, shared, anchoredLegacy,
    legacyUnverified, identityConflicts, perDictionary,
  }
}
