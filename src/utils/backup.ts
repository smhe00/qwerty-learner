import { db } from '@/utils/db'
import { peakImportFile } from 'dexie-export-import'

export const BACKUP_FORMAT_VERSION = 'qwerty-backup-v3'
export const LEGACY_BACKUP_FORMAT_VERSION = 'qwerty-dexie-gzip-v2'
export const SUPPORTED_BACKUP_FORMAT_VERSIONS = [
  BACKUP_FORMAT_VERSION,
  LEGACY_BACKUP_FORMAT_VERSION,
] as const

export type BackupLearningState = {
  currentDict: string
  currentChapter: number
}

export type BackupProgress = {
  totalRows?: number
  completedRows: number
  done: boolean
}

type BackupEnvelopeV3 = {
  backupFormatVersion: typeof BACKUP_FORMAT_VERSION
  learningState: BackupLearningState
  database: unknown
}

function parseStoredValue<T>(key: string, fallback: T): T {
  const raw = localStorage.getItem(key)
  if (raw === null) return fallback

  try {
    return JSON.parse(raw) as T
  } catch {
    return raw as T
  }
}

export function readLearningState(): BackupLearningState {
  const currentDict = parseStoredValue<string>('currentDict', 'zhongkaohexin')
  const rawChapter = parseStoredValue<number>('currentChapter', 0)
  const currentChapter =
    Number.isInteger(rawChapter) && Number(rawChapter) >= 0 ? Number(rawChapter) : 0

  return {
    currentDict:
      typeof currentDict === 'string' && currentDict.trim() ? currentDict : 'zhongkaohexin',
    currentChapter,
  }
}

function notifyStorageChange(
  key: string,
  oldValue: string | null,
  newValue: string | null,
) {
  notifyStorageChange(key, oldValue, newValue)
}

function writeStorageValue(key: string, value: string | number) {
  const oldValue = localStorage.getItem(key)
  const newValue = JSON.stringify(value)
  localStorage.setItem(key, newValue)

  try {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key,
        oldValue,
        newValue,
        storageArea: localStorage,
        url: window.location.href,
      }),
    )
  } catch {
    window.dispatchEvent(new Event('storage'))
  }
}

export function resetReviewModeInfoAfterRestore() {
  const key = 'reviewModeInfo'
  const oldValue = localStorage.getItem(key)
  const newValue = JSON.stringify({ isReviewMode: false })
  localStorage.setItem(key, newValue)
  notifyStorageChange(key, oldValue, newValue)
}

export function restoreLearningState(state: BackupLearningState) {
  const currentDict =
    typeof state.currentDict === 'string' && state.currentDict.trim()
      ? state.currentDict
      : 'zhongkaohexin'
  const currentChapter =
    Number.isInteger(state.currentChapter) && state.currentChapter >= 0
      ? state.currentChapter
      : 0

  writeStorageValue('currentDict', currentDict)
  writeStorageValue('currentChapter', currentChapter)

  return { currentDict, currentChapter }
}

export function isSupportedBackupFormat(version: string | null | undefined) {
  return (
    version === BACKUP_FORMAT_VERSION ||
    version === LEGACY_BACKUP_FORMAT_VERSION
  )
}

export async function exportBackupJson(
  progressCallback?: (progress: BackupProgress) => boolean,
) {
  const databaseBlob = await db.export({
    progressCallback: ({ totalRows, completedRows, done }) =>
      progressCallback ? progressCallback({ totalRows, completedRows, done }) : true,
  })
  const databaseJson = await databaseBlob.text()

  const envelope: BackupEnvelopeV3 = {
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    learningState: readLearningState(),
    database: JSON.parse(databaseJson),
  }

  return JSON.stringify(envelope)
}

function decodeBackupJson(
  json: string,
  clientFormatVersion?: string | null,
): {
  databaseJson: string
  learningState: BackupLearningState | null
} {
  const parsed = JSON.parse(json) as Partial<BackupEnvelopeV3> & Record<string, unknown>

  if (
    clientFormatVersion !== undefined &&
    clientFormatVersion !== null &&
    !isSupportedBackupFormat(clientFormatVersion)
  ) {
    throw new Error('备份数据格式不受支持。')
  }

  const shouldUseEnvelope =
    clientFormatVersion === BACKUP_FORMAT_VERSION ||
    parsed.backupFormatVersion === BACKUP_FORMAT_VERSION

  if (shouldUseEnvelope) {
    if (
      parsed.backupFormatVersion !== BACKUP_FORMAT_VERSION ||
      !parsed.database ||
      !parsed.learningState ||
      typeof parsed.learningState.currentDict !== 'string' ||
      !Number.isInteger(parsed.learningState.currentChapter)
    ) {
      throw new Error('备份数据缺少有效的学习状态或数据库内容。')
    }

    return {
      databaseJson: JSON.stringify(parsed.database),
      learningState: {
        currentDict: parsed.learningState.currentDict,
        currentChapter: parsed.learningState.currentChapter,
      },
    }
  }

  return {
    databaseJson: json,
    learningState: null,
  }
}

export async function importBackupJson(
  json: string,
  {
    clientFormatVersion,
    progressCallback,
  }: {
    clientFormatVersion?: string | null
    progressCallback?: (progress: BackupProgress) => boolean
  } = {},
) {
  const decoded = decodeBackupJson(json, clientFormatVersion)
  const databaseBlob = new Blob([decoded.databaseJson], { type: 'application/json' })
  const importMeta = await peakImportFile(databaseBlob)
  const hasReviewWordStates = importMeta.data.tables.some(
    (table) => table.name === 'reviewWordStates',
  )

  await db.import(databaseBlob, {
    acceptVersionDiff: true,
    acceptMissingTables: true,
    acceptNameDiff: false,
    acceptChangedPrimaryKey: false,
    overwriteValues: true,
    clearTablesBeforeImport: true,
    progressCallback: ({ totalRows, completedRows, done }) =>
      progressCallback ? progressCallback({ totalRows, completedRows, done }) : true,
  })

  if (!hasReviewWordStates) {
    await db.reviewWordStates.clear()
  }

  // reviewModeInfo is a route-critical localStorage cache, while the durable
  // Learn session lives in IndexedDB.reviewRecords. Never let a pre-restore
  // browser cache resurrect a session that does not belong to the imported DB.
  resetReviewModeInfoAfterRestore()

  const restoredLearningState = decoded.learningState
    ? restoreLearningState(decoded.learningState)
    : null

  return {
    restoredLearningState,
    hasLearningState: restoredLearningState !== null,
  }
}
