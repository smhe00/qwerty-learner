/* eslint-env node */
/**
 * Server-side verification for versioned Sync V2 Backup V4 uploads.
 * Mirror of src/sync/workspace-v4.ts canonicalWorkspaceData/stableWorkspaceJson;
 * parity checked against the browser implementation by Node + esbuild tests.
 * Never rely on a client-supplied digest or account owner.
 */
import crypto from 'node:crypto'
import { gunzipSync } from 'node:zlib'

export const V4_FORMAT = 'qwerty-backup-v4'
const MAX_INFLATED_BYTES = 32 * 1024 * 1024
const SETTING_KEYS = new Set([
  'memoryConfig', 'loopWordConfig', 'keySoundsConfig', 'hintSoundsConfig',
  'pronunciation', 'phoneticConfig', 'fontsize', 'isOpenDarkModeAtom',
  'randomConfig', 'typingTransVisible', 'isShowPrevAndNextWord',
  'isIgnoreCase', 'isShowAnswerOnHover', 'isTextSelectable',
  'wordDictationConfig',
])

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stable(value) {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw Error('Non-JSON workspace value')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  return `{${Object.keys(value).sort().filter(k => value[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`
}

function canonicalData(data) {
  const db = data.database
  const root = object(db.data) ? db.data : null
  let logicalDatabase = db
  if (root && Array.isArray(root.tables) && Array.isArray(root.data)) {
    logicalDatabase = {
      tables: [...root.tables].sort((a, b) =>
        stable(object(a) ? a.name : a).localeCompare(stable(object(b) ? b.name : b))),
      data: root.data.map(entry => {
        if (!object(entry) || !Array.isArray(entry.rows)) return entry
        return { ...entry, rows: [...entry.rows].sort((a, b) =>
          stable(a).localeCompare(stable(b))) }
      }).sort((a, b) =>
        stable(object(a) ? a.tableName : a)
          .localeCompare(stable(object(b) ? b.tableName : b))),
    }
  }
  return {
    database: logicalDatabase,
    learnRuntime: data.learnRuntime,
    settings: data.settings,
    navigation: data.navigation,
  }
}

function assertV4(snapshot, expectedAccountId) {
  if (!object(snapshot) || snapshot.backupFormatVersion !== V4_FORMAT ||
      !object(snapshot.workspaceData) || !object(snapshot.metadata) ||
      typeof snapshot.metadata.createdAt !== 'string' ||
      !object(snapshot.metadata.source) ||
      snapshot.metadata.source.kind !== 'account' ||
      snapshot.metadata.source.accountId !== expectedAccountId) {
    throw Error('Invalid V4 envelope or immutable account identity mismatch')
  }
  const data = snapshot.workspaceData
  if (!object(data.database) || !object(data.database.data) ||
      !Array.isArray(data.database.data.tables) ||
      !Array.isArray(data.database.data.data) ||
      !object(data.settings) || data.settings.version !== 1 ||
      !object(data.settings.values) || !object(data.learnRuntime) ||
      !object(data.learnRuntime.dailySessions) ||
      !object(data.navigation) || typeof data.navigation.currentDict !== 'string' ||
      !data.navigation.currentDict.trim() ||
      !Number.isInteger(data.navigation.currentChapter) ||
      data.navigation.currentChapter < 0) {
    throw Error('Invalid V4 logical workspace structure')
  }
  for (const key of Object.keys(data.settings.values)) {
    if (!SETTING_KEYS.has(key)) throw Error('Disallowed V4 workspace setting')
  }
  for (const [dict, session] of Object.entries(data.learnRuntime.dailySessions)) {
    if (!dict || !object(session) || session.version !== 1 ||
        session.dict !== dict || typeof session.sessionId !== 'string' ||
        typeof session.dateKey !== 'string' ||
        !Number.isFinite(session.startedAt) ||
        !['active', 'completed', 'abandoned'].includes(session.status) ||
        !Number.isInteger(session.dailyNewTarget) ||
        !Number.isInteger(session.plannedNewWords) ||
        !Number.isInteger(session.blockCount) ||
        !Array.isArray(session.plannedReviewWords) ||
        !Array.isArray(session.carryOverAcquisitionWords) ||
        !Array.isArray(session.completedBlockIds)) {
      throw Error('Invalid V4 durable DailySession')
    }
  }
}

export function verifyCompressedV4(payload, expectedAccountId, claimedFingerprint) {
  if (typeof expectedAccountId !== 'string' || !expectedAccountId.trim()) {
    throw Error('Missing immutable account owner')
  }
  if (typeof claimedFingerprint !== 'string' ||
      !/^[a-f0-9]{64}$/.test(claimedFingerprint)) {
    throw Error('Missing or invalid canonical V4 logical fingerprint')
  }
  let inflated
  try {
    inflated = gunzipSync(payload, { maxOutputLength: MAX_INFLATED_BYTES })
  } catch {
    throw Error('Invalid gzip V4 payload or maximum inflated size exceeded')
  }
  let snapshot
  try { snapshot = JSON.parse(inflated.toString('utf8')) }
  catch { throw Error('V4 gzip payload is not valid JSON') }
  assertV4(snapshot, expectedAccountId)
  const logicalFingerprint = crypto.createHash('sha256')
    .update(stable(canonicalData(snapshot.workspaceData)), 'utf8')
    .digest('hex')
  if (logicalFingerprint !== claimedFingerprint) {
    throw Error('V4 logical fingerprint does not match canonical content')
  }
  return { logicalFingerprint, snapshot }
}
