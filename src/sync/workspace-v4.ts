/**
 * S0/S1 canonical workspace envelope. This module does not mutate V1 storage,
 * change the existing CloudSync V1 payload, or access browser globals.
 */
import type { LearnDailySessionV1 } from '@/learn/daily-session'

export const WORKSPACE_V4_FORMAT = 'qwerty-backup-v4' as const
export const WORKSPACE_SETTINGS_VERSION = 1 as const
export const DAILY_SESSION_PREFIX = 'qwerty.learn.dailySession.v1.'
/** Stable origin-wide witness: detects legacy tabs clearing localStorage even after S1 owner closes. */
export const S1_MIGRATION_WITNESS_KEY = 'qwerty.s1.workspace-migrated.v1'

/** Deliberate allowlist, never enumerate all localStorage keys as settings. */
export const WORKSPACE_SETTING_KEYS = [
  'memoryConfig',
  'loopWordConfig',
  'keySoundsConfig',
  'hintSoundsConfig',
  'pronunciation',
  'phoneticConfig',
  'fontsize',
  'isOpenDarkModeAtom',
  'randomConfig',
  'typingTransVisible',
  'isShowPrevAndNextWord',
  'isIgnoreCase',
  'isShowAnswerOnHover',
  'isTextSelectable',
  'wordDictationConfig',
] as const

export type StorageReader = {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
}

export type WorkspaceIdentityV4 =
  | { kind: 'anonymous' }
  | { kind: 'account'; accountId: string }

export type WorkspaceSettingsV1 = {
  version: typeof WORKSPACE_SETTINGS_VERSION
  values: Record<string, unknown>
}

export type WorkspaceDataV4 = {
  database: unknown
  learnRuntime: { dailySessions: Record<string, LearnDailySessionV1> }
  settings: WorkspaceSettingsV1
  navigation: { currentDict: string; currentChapter: number }
}

export type WorkspaceSnapshotV4 = {
  backupFormatVersion: typeof WORKSPACE_V4_FORMAT
  workspaceData: WorkspaceDataV4
  metadata: {
    createdAt: string
    source: WorkspaceIdentityV4
  }
}

type JsonRecord = Record<string, unknown>
const allowedSettings: ReadonlySet<string> = new Set(WORKSPACE_SETTING_KEYS)

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function validIdentity(value: unknown): value is WorkspaceIdentityV4 {
  if (!isRecord(value)) return false
  if (value.kind === 'anonymous') return true
  return value.kind === 'account' &&
    typeof value.accountId === 'string' &&
    value.accountId.trim().length > 0 &&
    value.accountId === value.accountId.trim()
}

function isDailySession(value: unknown, dict: string): value is LearnDailySessionV1 {
  return isRecord(value) &&
    value.version === 1 && value.dict === dict &&
    typeof value.sessionId === 'string' &&
    typeof value.dateKey === 'string' &&
    typeof value.startedAt === 'number' &&
    Number.isFinite(value.startedAt) &&
    (value.status === 'active' || value.status === 'completed' || value.status === 'abandoned') &&
    Number.isInteger(value.dailyNewTarget) &&
    Number.isInteger(value.plannedNewWords) &&
    Number.isInteger(value.blockCount) &&
    Array.isArray(value.plannedReviewWords) &&
    Array.isArray(value.carryOverAcquisitionWords) &&
    Array.isArray(value.completedBlockIds)
}

function isNavigation(value: unknown): value is WorkspaceDataV4['navigation'] {
  return isRecord(value) &&
    typeof value.currentDict === 'string' &&
    value.currentDict.trim().length > 0 &&
    Number.isInteger(value.currentChapter) &&
    (value.currentChapter as number) >= 0
}

export function captureWorkspaceSettings(storage: StorageReader): WorkspaceSettingsV1 {
  const values: Record<string, unknown> = Object.create(null)
  for (const key of WORKSPACE_SETTING_KEYS) {
    const raw = storage.getItem(key)
    if (raw === null) continue
    try {
      // Persist JSON-compatible values only; malformed entries must not be copied.
      const parsed: unknown = JSON.parse(raw)
      if (parsed !== undefined) values[key] = parsed
    } catch {
      // Legacy malformed preferences are omitted; product defaults apply.
    }
  }
  return { version: WORKSPACE_SETTINGS_VERSION, values }
}

export function captureDailySessions(storage: StorageReader): Record<string, LearnDailySessionV1> {
  const sessions: Record<string, LearnDailySessionV1> = Object.create(null)
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key?.startsWith(DAILY_SESSION_PREFIX)) continue
    const dict = key.slice(DAILY_SESSION_PREFIX.length)
    if (!dict) throw new Error('DailySession has no dictionary identifier')
    const raw = storage.getItem(key)
    if (raw === null) continue
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch {
      throw new Error(`Corrupt durable DailySession: ${dict}`)
    }
    if (!isDailySession(parsed, dict)) {
      throw new Error(`Invalid durable DailySession: ${dict}`)
    }
    sessions[dict] = parsed
  }
  return sessions
}

function assertValidSnapshot(input: unknown): asserts input is WorkspaceSnapshotV4 {
  if (!isRecord(input) ||
      input.backupFormatVersion !== WORKSPACE_V4_FORMAT ||
      !isRecord(input.workspaceData) ||
      !isRecord(input.metadata) ||
      typeof input.metadata.createdAt !== 'string' ||
      !validIdentity(input.metadata.source)) {
    throw new Error('Invalid Backup V4 envelope')
  }
  const data = input.workspaceData
  if (!isRecord(data.database) ||
      !isNavigation(data.navigation) ||
      !isRecord(data.settings) ||
      data.settings.version !== WORKSPACE_SETTINGS_VERSION ||
      !isRecord(data.settings.values) ||
      !isRecord(data.learnRuntime) ||
      !isRecord(data.learnRuntime.dailySessions)) {
    throw new Error('Invalid Backup V4 workspace payload')
  }
  for (const key of Object.keys(data.settings.values)) {
    if (!allowedSettings.has(key)) throw new Error(`Disallowed workspace setting: ${key}`)
  }
  for (const [dict, value] of Object.entries(data.learnRuntime.dailySessions)) {
    if (!isDailySession(value, dict)) throw new Error(`Invalid Backup V4 DailySession: ${dict}`)
  }
}

export function parseWorkspaceV4(json: string): WorkspaceSnapshotV4 {
  const parsed: unknown = JSON.parse(json)
  assertValidSnapshot(parsed)
  return parsed
}

export function createWorkspaceV4(
  workspaceData: WorkspaceDataV4,
  metadata: WorkspaceSnapshotV4['metadata'],
): WorkspaceSnapshotV4 {
  const snapshot = { backupFormatVersion: WORKSPACE_V4_FORMAT, workspaceData, metadata }
  assertValidSnapshot(snapshot)
  return snapshot
}

/** Converts V3 content without altering its source, revision, or cloud hashes.
 * Existing current-browser settings/runtime are used ONLY for explicit one-time
 * same-browser migration. Historical imports without them leave those fields empty. */
export function migrateV3ToWorkspaceV4(
  legacyJson: string,
  metadata: WorkspaceSnapshotV4['metadata'],
  options: { storage?: StorageReader } = {},
): WorkspaceSnapshotV4 {
  const parsed: unknown = JSON.parse(legacyJson)
  if (!isRecord(parsed) ||
      parsed.backupFormatVersion !== 'qwerty-backup-v3' ||
      !isRecord(parsed.database) ||
      !isNavigation(parsed.learningState)) {
    throw new Error('Not a supported qwerty-backup-v3 envelope')
  }
  return createWorkspaceV4({
    database: parsed.database,
    learnRuntime: {
      dailySessions: options.storage ? captureDailySessions(options.storage) : {},
    },
    settings: options.storage
      ? captureWorkspaceSettings(options.storage)
      : { version: 1, values: {} },
    navigation: parsed.learningState,
  }, metadata)
}

/** Stable recursive JSON representation; arrays retain sequence semantics. */
export function stableWorkspaceJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const result = JSON.stringify(value)
    if (result === undefined) throw new Error('Non-JSON workspace value')
    return result
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableWorkspaceJson).join(',')}]`
  }
  const object = value as JsonRecord
  return `{${Object.keys(object).sort().filter(k => object[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${stableWorkspaceJson(object[k])}`).join(',')}}`
}

/** Dexie export tables and row collection order are non-semantic. */
export function canonicalWorkspaceData(data: WorkspaceDataV4): unknown {
  const db = data.database as JsonRecord
  const root = isRecord(db.data) ? db.data : null
  let logicalDatabase: unknown = db
  if (root && Array.isArray(root.tables) && Array.isArray(root.data)) {
    logicalDatabase = {
      tables: [...root.tables].sort((a, b) =>
        stableWorkspaceJson(isRecord(a) ? a.name : a)
          .localeCompare(stableWorkspaceJson(isRecord(b) ? b.name : b))),
      data: root.data.map(entry => {
        if (!isRecord(entry) || !Array.isArray(entry.rows)) return entry
        return { ...entry, rows: [...entry.rows].sort((a, b) =>
          stableWorkspaceJson(a).localeCompare(stableWorkspaceJson(b))) }
      }).sort((a, b) =>
        stableWorkspaceJson(isRecord(a) ? a.tableName : a)
          .localeCompare(stableWorkspaceJson(isRecord(b) ? b.tableName : b))),
    }
  }
  return {
    database: logicalDatabase,
    learnRuntime: data.learnRuntime,
    settings: data.settings,
    navigation: data.navigation,
  }
}

export async function workspaceFingerprintV4(snapshot: WorkspaceSnapshotV4): Promise<string> {
  assertValidSnapshot(snapshot)
  const encoded = new TextEncoder().encode(
    stableWorkspaceJson(canonicalWorkspaceData(snapshot.workspaceData)),
  )
  const bytes = await crypto.subtle.digest('SHA-256', encoded)
  return [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('')
}

/** A V4 envelope may be inspected without a complete table manifest,
 * but a destructive full restore requires all six durable data tables.
 * Otherwise the legacy V3 importer clears absent tables. */
export const REQUIRED_RESTORABLE_V4_TABLES = [
  'wordRecords', 'chapterRecords', 'reviewRecords', 'reviewWordStates',
  'achievementEvents', 'achievementStates',
] as const

export function assertRestorableWorkspaceV4(snapshot: WorkspaceSnapshotV4): void {
  assertValidSnapshot(snapshot)
  const database = snapshot.workspaceData.database as JsonRecord
  const nested = database.data
  if (database.formatName !== 'dexie' || !isRecord(nested) ||
      !Array.isArray(nested.tables) || !Array.isArray(nested.data)) {
    throw new Error('V4 full restore requires complete Dexie table manifest')
  }
  const tables = nested.tables as unknown[]
  const rows = nested.data as unknown[]
  const names = tables.map(x => isRecord(x) ? x.name : undefined)
  const rowNames = rows.map(x => isRecord(x) ? x.tableName : undefined)
  if (names.some(name => typeof name !== 'string') ||
      new Set(names).size !== names.length ||
      REQUIRED_RESTORABLE_V4_TABLES.some(name => !names.includes(name)) ||
      rowNames.some(name => typeof name !== 'string' || !names.includes(name)) ||
      new Set(rowNames).size !== rowNames.length ||
      rows.some(x => !isRecord(x) || !Array.isArray(x.rows))) {
    throw new Error('V4 full restore missing or duplicate durable tables')
  }
}
