import { switchAuthenticatedWorkspace, reconcileAuthTransition, S1_AUTH_INTENT_KEY, reauthenticateSameWorkspace } from '../../src/sync/workspace-auth-transaction'
import { assertLegacyAuthChangeAllowed, assertLegacyCloudMutationAllowed, assertLegacyLocalDestructiveOperationAllowed } from '../../src/sync/workspace-auth-guard'
import { mountGuardedWorkspaceApp } from '../../src/sync/workspace-bootstrap'
import { initializeLegacyWorkspace, transitionWorkingWorkspace } from '../../src/sync/workspace-coordinator'
import { acquireWorkspaceWriterLease } from '../../src/sync/workspace-lock'
import { captureWorkingWorkspaceV4, resetWorkingWorkspaceToEmpty, restoreWorkingWorkspaceV4 } from '../../src/sync/workspace-v4-browser'
import { createWorkspaceV4, workspaceFingerprintV4 } from '../../src/sync/workspace-v4'
import { loadWorkspaceFromVault, saveWorkspaceToVault, workspaceRegistryPort, openWorkspaceVault } from '../../src/sync/workspace-vault'
import { switchWorkspace, recoverWorkspace, ANONYMOUS } from '../../src/sync/workspace-transition'
import { createLocalSnapshot, fingerprintRemoteUserActions, restoreLocalSnapshot } from '../../src/sync/snapshot'
import {
  DURABLE_BACKUP_TABLE_NAMES,
  exportBackupJson,
  importBackupJson,
} from '../../src/utils/backup'
import { db } from '../../src/utils/db'
import { inspectLocalState } from '../../src/sync/snapshot'
import { assessSyncState, canReconcileLegacySyncBaseline, loadSyncBaseline, saveSyncBaseline } from '../../src/sync/state'

const now = Math.floor(
  new Date('2026-10-03T00:00:00.000Z').getTime() / 1000,
)
const word = 'backup-fsrs-word'
const dict = 'cet4'

async function clearAllTables() {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
}

function buildShadow(sourceRecordId: number) {
  return {
    schemaVersion: 1,
    libraryVersion: '5.4.2',
    algorithmModel: 'fsrs-6',
    parameterSetId: 'fsrs6-default-r0.90-no-fuzz-long-term-v1',
    dict,
    word,
    sourceRecordId,
    eventTime: now,
    rating: 'good',
    retrievabilityBefore: 0.82,
    before: {
      dueAt: now,
      lastReviewAt: now - 86_400,
      stability: 3.2,
      difficulty: 5.1,
      elapsedDays: 1,
      scheduledDays: 1,
      reps: 2,
      lapses: 0,
      learningSteps: 0,
      state: 2,
    },
    after: {
      dueAt: now + 7 * 86_400,
      lastReviewAt: now,
      stability: 7.4,
      difficulty: 4.9,
      elapsedDays: 1,
      scheduledDays: 7,
      reps: 3,
      lapses: 0,
      learningSteps: 0,
      state: 2,
    },
    selectedIntervalDays: 7,
    counterfactual: {
      again: {
        dueAt: now + 86_400,
        intervalDays: 1,
        stability: 1.2,
        difficulty: 6.8,
        state: 3,
      },
      hard: {
        dueAt: now + 3 * 86_400,
        intervalDays: 3,
        stability: 3.5,
        difficulty: 5.8,
        state: 2,
      },
      good: {
        dueAt: now + 7 * 86_400,
        intervalDays: 7,
        stability: 7.4,
        difficulty: 4.9,
        state: 2,
      },
      easy: {
        dueAt: now + 14 * 86_400,
        intervalDays: 14,
        stability: 14.2,
        difficulty: 4.2,
        state: 2,
      },
    },
    historyCoverage: 'review-count-matched',
    replayedEligibleEvents: 3,
    basicV2: {
      dueAt: now + 14 * 86_400,
      nominalIntervalDays: 14,
      reviewCount: 3,
      lapseCount: 0,
    },
  }
}

async function seed() {
  await clearAllTables()

  const wordRecordId = await db.wordRecords.add({
    word,
    timeStamp: now,
    dict,
    chapter: -1,
    timing: [120, 150, 130],
    wrongCount: 0,
    mistakes: {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    reviewRatingDecision: {
      eligible: true,
      rating: 'good',
      confidence: 1,
      reasonCodes: ['backup-roundtrip'],
    },
  })

  await db.wordRecords.update(wordRecordId, {
    fsrsShadow: buildShadow(wordRecordId),
  })

  await db.reviewWordStates.add({
    dict,
    word,
    createdAt: now - 30 * 86_400,
    updatedAt: now,
    lastReviewedAt: now,
    nextReviewAt: now + 14 * 86_400,
    reviewCount: 3,
    lapseCount: 0,
    cleanStreak: 3,
    lastOutcome: 'good',
    lifecycle: 'active',
    stateVersion: 4,
    schedulerState: {
      kind: 'basic-v2',
      stage: 4,
      intervalDays: 14,
    },
  })

  await db.reviewRecords.add({
    dict,
    index: 0,
    createTime: now,
    isFinished: false,
    words: [
      {
        name: word,
        trans: ['用于备份回归测试'],
      },
    ],
    sessionKind: 'review',
    reinforcementCounts: {
      [word]: 1,
    },
  })

  await db.achievementEvents.add({
    eventId: 'backup-achievement-event',
    eventType: 'word_mastered',
    origin: 'live',
    sourceRecordId: wordRecordId,
    sessionId: 'backup-session',
    occurredAt: now,
    dict,
    word,
    metricValues: {
      mastered_words: 1,
    },
    unlockedAchievementIds: ['ACH_BACKUP_ROUNDTRIP'],
  })

  await db.achievementStates.add({
    achievementId: 'ACH_BACKUP_ROUNDTRIP',
    unlockedAt: now,
    firstTriggerEventId: 'backup-achievement-event',
    sourceRecordId: wordRecordId,
    sessionId: 'backup-session',
    seenAt: now + 1,
    cultureCardSeenAt: now + 2,
  })

  localStorage.setItem('currentDict', JSON.stringify(dict))
  localStorage.setItem('currentChapter', JSON.stringify(3))
  localStorage.setItem(
    'reviewModeInfo',
    JSON.stringify({
      isReviewMode: true,
      reviewRecord: {
        dict,
        index: 0,
        createTime: now,
        isFinished: false,
        words: [{ name: word, trans: ['stale-cache'] }],
        sessionKind: 'review',
      },
    }),
  )

  return { wordRecordId }
}

async function poisonBeforeRestore() {
  await clearAllTables()
  localStorage.setItem('currentDict', JSON.stringify('nce4'))
  localStorage.setItem('currentChapter', JSON.stringify(99))
  localStorage.setItem(
    'reviewModeInfo',
    JSON.stringify({
      isReviewMode: true,
      reviewRecord: {
        dict: 'nce4',
        index: 7,
        createTime: now + 999,
        isFinished: false,
        words: [{ name: 'wrong-session', trans: [] }],
        sessionKind: 'review',
      },
    }),
  )
}

async function inspect() {
  const wordRecord = await db.wordRecords.where('word').equals(word).first()
  const reviewWordState = await db.reviewWordStates
    .where('[dict+word]')
    .equals([dict, word])
    .first()
  const reviewRecord = (
    await db.reviewRecords.where('dict').equals(dict).toArray()
  ).find((record) => !record.isFinished)
  const achievementEvent = await db.achievementEvents.get(
    'backup-achievement-event',
  )
  const achievementState = await db.achievementStates.get(
    'ACH_BACKUP_ROUNDTRIP',
  )

  return {
    wordRecord,
    reviewWordState,
    reviewRecord,
    achievementEvent,
    achievementState,
    currentDict: JSON.parse(localStorage.getItem('currentDict') || 'null'),
    currentChapter: JSON.parse(
      localStorage.getItem('currentChapter') || 'null',
    ),
    reviewModeInfo: JSON.parse(
      localStorage.getItem('reviewModeInfo') || 'null',
    ),
  }
}

async function inspectTableContract() {
  const json = await exportBackupJson()
  const parsed = JSON.parse(json) as {
    database?: {
      data?: {
        tables?: Array<{ name?: string }>
      }
    }
  }
  const exported = (parsed.database?.data?.tables ?? [])
    .map((table) => table.name)
    .filter((name): name is string => typeof name === 'string')
    .sort()

  return {
    manifest: [...DURABLE_BACKUP_TABLE_NAMES].sort(),
    runtime: db.tables.map((table) => table.name).sort(),
    exported,
  }
}

;(window as any).__backupHarness = {
  seed,
  poisonBeforeRestore,
  inspect,
  inspectTableContract,
  exportBackupJson,
  importBackupJson,
  clearAllTables,
  createLocalSnapshot,
  inspectLocalState,
  restoreLocalSnapshot,
  fingerprintRemoteUserActions,
  assessSyncState,
  canReconcileLegacySyncBaseline,
  loadSyncBaseline,
  saveSyncBaseline,
  captureWorkingWorkspaceV4,
  resetWorkingWorkspaceToEmpty,
  restoreWorkingWorkspaceV4,
  createWorkspaceV4,
  workspaceFingerprintV4,
  loadWorkspaceFromVault,
  saveWorkspaceToVault,
  workspaceRegistryPort,
  openWorkspaceVault,
  switchWorkspace,
  recoverWorkspace,
  ANONYMOUS,
  db,
  initializeLegacyWorkspace,
  transitionWorkingWorkspace,
  acquireWorkspaceWriterLease,
  mountGuardedWorkspaceApp,
  assertLegacyAuthChangeAllowed,
  assertLegacyCloudMutationAllowed,
  assertLegacyLocalDestructiveOperationAllowed,
  switchAuthenticatedWorkspace,
  reconcileAuthTransition,
  reauthenticateSameWorkspace,
  S1_AUTH_INTENT_KEY,
}
