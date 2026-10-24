import { timePerfStage } from './perf-diagnostics'
/** Isolated decoding/re-export: never modify the live RecordDB while planning. */
import { createDexieImportBlob } from '@/utils/db/dexie-import-blob'
import { AUTO_MERGE_TABLES, mergeDecodedV4Tables, mergeValueKey } from './automatic-v4-records'
import type { MergeRow, MergeTables } from './automatic-v4-records'
import { sameLosslessIndexedDbValue } from './m4-lossless-idb-compare'
import { secureRandomUuid } from './sha256-compat'
import { assertRestorableWorkspaceV4 } from './workspace-v4'
import type { WorkspaceSnapshotV4 } from './workspace-v4'
import type { LearnDailySessionV1 } from '@/learn/daily-session'
import { applyRecordClassMappings } from '@/utils/db/core'
import Dexie from 'dexie'
import 'dexie-export-import'

type Export = {
  formatName: string
  formatVersion: number
  data: {
    databaseName: string
    databaseVersion: number
    tables: Array<{ name: string; schema: string; rowCount: number }>
    data: Array<{ tableName: string; rows: unknown[] }>
  }
}
function shape(snapshot: WorkspaceSnapshotV4): Export {
  assertRestorableWorkspaceV4(snapshot)
  const data = snapshot.workspaceData.database as Export
  if (
    data.data.tables.length !== AUTO_MERGE_TABLES.length ||
    AUTO_MERGE_TABLES.some((name) => !data.data.data.some((t) => t.tableName === name))
  ) {
    throw Error('auto-merge-unsupported-table-manifest')
  }
  return data
}
async function openCopy(snapshot: WorkspaceSnapshotV4, names: Dexie[]): Promise<Dexie> {
  const original = shape(snapshot)
  const name = 'qwerty-auto-merge-' + secureRandomUuid()
  const copy = new Dexie(name)
  names.push(copy)
  copy.version(original.data.databaseVersion).stores(Object.fromEntries(original.data.tables.map((t) => [t.name, t.schema])))
  applyRecordClassMappings(copy)
  const encoded = { ...original, data: { ...original.data, databaseName: name } }
  await copy.import(createDexieImportBlob(JSON.stringify(encoded)), {
    acceptNameDiff: false,
    acceptVersionDiff: false,
    acceptMissingTables: false,
    acceptChangedPrimaryKey: false,
    clearTablesBeforeImport: true,
  })
  return copy
}
async function raw(db: Dexie): Promise<MergeTables> {
  return Object.fromEntries(
    (await Promise.all(AUTO_MERGE_TABLES.map(async (name) => [name, await db.table(name).toCollection().raw().toArray()]))) as Array<
      [string, unknown]
    >,
  ) as MergeTables
}
function dailyChoice(a: LearnDailySessionV1 | undefined, b: LearnDailySessionV1 | undefined): LearnDailySessionV1 {
  if (!a && !b) throw Error('auto-merge-missing-daily-session')
  if (!a) return structuredClone(b as LearnDailySessionV1)
  if (!b) return structuredClone(a)
  // Most recent cohort, then an actual completed/advanced session variant.
  const score = (s: LearnDailySessionV1) => [
    s.startedAt ?? 0,
    s.status === 'completed' ? 1 : 0,
    s.completedBlockIds?.length ?? 0,
    s.accumulatedActiveSeconds ?? 0,
  ]
  const left = score(a),
    right = score(b)
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return structuredClone(left[i] > right[i] ? a : b)
  }
  return structuredClone(mergeValueKey(a) >= mergeValueKey(b) ? a : b)
}
export async function mergeAccountV4Snapshots(local: WorkspaceSnapshotV4, remote: WorkspaceSnapshotV4): Promise<WorkspaceSnapshotV4> {
  const a = shape(local),
    b = shape(remote)
  if (
    local.metadata.source.kind !== 'account' ||
    remote.metadata.source.kind !== 'account' ||
    local.metadata.source.accountId !== remote.metadata.source.accountId
  ) {
    throw Error('auto-merge-account-mismatch')
  }
  const schema = (x: Export) =>
    mergeValueKey({
      version: x.data.databaseVersion,
      tables: x.data.tables.map((t) => ({ name: t.name, schema: t.schema })).sort((x, y) => (x.name < y.name ? -1 : 1)),
    })
  if (schema(a) !== schema(b)) throw Error('auto-merge-schema-mismatch')
  // Unknown future runtime fields must have the same meaning on both copies.
  const rest = (s: WorkspaceSnapshotV4) => {
    const other: Record<string, unknown> = { ...s.workspaceData.learnRuntime }
    delete other.dailySessions
    return mergeValueKey(other)
  }
  if (rest(local) !== rest(remote)) throw Error('auto-merge-unknown-runtime-conflict')
  const copies: Dexie[] = []
  try {
    const left = await timePerfStage('sync', 'merge-decode-local', () => openCopy(local, copies))
    const right = await timePerfStage('sync', 'merge-decode-cloud', () => openCopy(remote, copies))
    const leftRows = await raw(left),
      rightRows = await raw(right)
    const merged = await timePerfStage('sync', 'merge-records', async () => mergeDecodedV4Tables(leftRows, rightRows))
    // The source exports remain immutable; the temporary left DB becomes candidate.
    await left.transaction('rw', left.tables, async () => {
      for (const name of AUTO_MERGE_TABLES) {
        await left.table(name).clear()
        if (merged[name].length) await left.table(name).bulkPut(merged[name])
      }
    })
    const candidate = structuredClone(local)
    const encoded = JSON.parse(await (await left.export()).text()) as Export
    encoded.data.databaseName = a.data.databaseName
    candidate.workspaceData.database = encoded
    candidate.workspaceData.settings.values = {
      ...structuredClone(local.workspaceData.settings.values),
      ...structuredClone(remote.workspaceData.settings.values),
    }
    // Concurrent navigation has no learning evidence; use the published cloud choice.
    candidate.workspaceData.navigation = structuredClone(remote.workspaceData.navigation)
    const daily: typeof candidate.workspaceData.learnRuntime.dailySessions = Object.create(null)
    for (const dict of Array.from(
      new Set([
        ...Object.keys(local.workspaceData.learnRuntime.dailySessions),
        ...Object.keys(remote.workspaceData.learnRuntime.dailySessions),
      ]),
    )) {
      daily[dict] = dailyChoice(local.workspaceData.learnRuntime.dailySessions[dict], remote.workspaceData.learnRuntime.dailySessions[dict])
    }
    candidate.workspaceData.learnRuntime.dailySessions = daily
    assertRestorableWorkspaceV4(candidate)
    // Independently IMPORT the generated export and compare raw structured-clone
    // values, not JSON hashes. This detects lost aliases and Typeson corruption.
    const check = await timePerfStage('sync', 'merge-decode-candidate', () => openCopy(candidate, copies))
    const decoded = await raw(check)
    for (const name of AUTO_MERGE_TABLES) {
      const key = (row: MergeRow) => row.id ?? row.eventId ?? row.achievementId
      const actual = new Map(decoded[name].map((row) => [key(row), row]))
      if (
        actual.size !== merged[name].length ||
        decoded[name].length !== merged[name].length ||
        merged[name].some(
          (row) =>
            !actual.has(key(row)) ||
            !sameLosslessIndexedDbValue(row, actual.get(key(row))) ||
            mergeValueKey(row) !== mergeValueKey(actual.get(key(row))),
        )
      ) {
        throw Error('auto-merge-lossless-roundtrip:' + name)
      }
    }
    return candidate
  } finally {
    await Promise.all(
      copies.map(async (copy) => {
        copy.close()
        await copy.delete()
      }),
    )
  }
}
