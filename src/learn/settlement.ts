import { processLiveLearnSessionCompletion } from '@/achievement'
import { getAchievementSessionId } from '@/achievement/session'
import {
  completeLearnDailySession,
  deriveLearnDailyProgress,
  loadLearnDailySession,
  recordLearnBlockCompletion,
} from './daily-session'
import type {
  LearnDailyProgress,
  LearnDailySessionV1,
} from './daily-session'
import { flushLearnPersistence } from './persistence'
import { autoSyncCompletedLearnSession } from '@/sync/auto'
import type { LearnAutoSyncResult } from '@/sync/auto'
import { db } from '@/utils/db/core'
import type { ReviewRecord } from '@/utils/db/record'

export type LearnBlockSettlement = {
  session: LearnDailySessionV1
  progress: LearnDailyProgress
}

export type LearnBlockSettlementInput = {
  record: ReviewRecord
  sourceRecordIds: number[]
  activeSeconds: number
  now?: number
}

/**
 * Durable boundary between an internal Learn Block and the next UI state.
 *
 * Ordering is intentional:
 * 1. achievement sidecar observes the finished block but may never block it;
 * 2. all raw/derived Learn persistence is flushed;
 * 3. the block is committed into DailySession;
 * 4. Daily progress is reconstructed from durable evidence;
 * 5. Daily completion is persisted and flushed once more.
 *
 * This function is UI-agnostic. React components may subscribe/re-subscribe to
 * the returned Promise (including StrictMode effect replay) without changing
 * settlement semantics.
 */
export async function settleLearnBlockDurably(
  input: LearnBlockSettlementInput,
): Promise<LearnBlockSettlement> {
  const record = structuredClone(input.record)
  const now = input.now ?? Math.floor(Date.now() / 1000)

  if (input.sourceRecordIds.length > 0) {
    try {
      await processLiveLearnSessionCompletion({
        sessionId: getAchievementSessionId(record),
        dict: record.dict,
        sourceRecordIds: [...input.sourceRecordIds],
        completedAt: now,
        recommendedGoalCompleted:
          record.isFinished &&
          record.recommendedGoal?.version === 1,
      })
    } catch (error) {
      // Achievement processing is a sidecar. A ceremony failure must never
      // weaken Learn recovery, checkpointing, or DailySession completion.
      console.error(
        'failed to process Learn block achievement settlement',
        error,
      )
    }
  }

  await flushLearnPersistence()

  const stored = loadLearnDailySession(record.dict)
  if (!stored) {
    throw new Error('DailySession checkpoint is missing')
  }

  let session = recordLearnBlockCompletion({
    session: stored,
    blockId: getAchievementSessionId(record),
    activeSeconds: input.activeSeconds,
  })

  const wordRecords = await db.wordRecords
    .where('dict')
    .equals(record.dict)
    .toArray()
  const progress = deriveLearnDailyProgress({
    session,
    wordRecords,
  })

  if (progress.complete) {
    session = completeLearnDailySession(session, now)
    await flushLearnPersistence()
  }

  return {
    session,
    progress,
  }
}

/**
 * Cloud upload is completion-only and deliberately outside the local durable
 * barrier. A slow/conflicted/offline sync must never delay Block Pause or
 * Daily Complete.
 */
export async function syncCompletedLearnSettlement(
  settlement: LearnBlockSettlement,
): Promise<LearnAutoSyncResult | undefined> {
  if (!settlement.progress.complete) return undefined
  return autoSyncCompletedLearnSession()
}
