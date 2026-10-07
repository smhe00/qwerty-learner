import { ensureLearnDailySession } from './daily-session'
import type { LearnDailySessionV1 } from './daily-session'
import { buildLearnDailyPlan } from './plan'
import type { LearnAcquisitionQuotaDecision } from './quota'
import { decideDailyAcquisitionQuota } from './quota'
import type { LearnStatsSnapshot } from './stats'
import { buildLearnStatsSnapshot } from './stats'
import type { IReviewWordState } from '@/review/types'
import type { Word } from '@/typings'
import type {
  IWordRecord,
  ReviewRecord,
} from '@/utils/db/record'

export type LearnPreparationSessionSource =
  | 'restored'
  | 'review'
  | 'acquisition'
  | 'mixed'

export type LearnPreparationWaitReason =
  | 'deferred'
  | 'empty'
  | 'review-due'
  | 'workload-budget'
  | 'quota'
  | 'daily-complete'

export type LearnPreparationDiagnostics = {
  now: number
  stats?: LearnStatsSnapshot
  quota?: LearnAcquisitionQuotaDecision
  allowedNewWordsNow?: number
  nextResumeAt?: number
  dailySession?: LearnDailySessionV1
}

export type LearnPreparationResult =
  | {
      kind: 'session'
      source: LearnPreparationSessionSource
      record: ReviewRecord
      diagnostics: LearnPreparationDiagnostics
    }
  | {
      kind: 'waiting'
      reason: LearnPreparationWaitReason
      statusText: string
      diagnostics: LearnPreparationDiagnostics
    }

export type LearnPreparationDependencies<ErrorEvidence> = {
  now: () => number
  bootstrap: (dictId: string, now: number) => Promise<void>
  getLatestSession: (
    dictId: string,
  ) => Promise<ReviewRecord | undefined>
  generateDueReview: (
    dictId: string,
    words: Word[],
    errorEvidence: ErrorEvidence[],
  ) => Promise<ReviewRecord | undefined>
  getWordRecords: (dictId: string) => Promise<IWordRecord[]>
  getWordStates: (dictId: string) => Promise<IReviewWordState[]>
  generateAcquisition: (
    dictId: string,
    words: Word[],
    freshLimit: number,
  ) => Promise<ReviewRecord | undefined>
  generateSession?: (
    dictId: string,
    words: Word[],
    errorEvidence: ErrorEvidence[],
    freshLimit: number,
  ) => Promise<ReviewRecord | undefined>
  getNextDeferredResumeAt: (
    dictId: string,
  ) => Promise<number | undefined>
  decideQuota?: typeof decideDailyAcquisitionQuota
  buildDailyPlan?: typeof buildLearnDailyPlan
}

function wait(
  reason: LearnPreparationWaitReason,
  statusText: string,
  diagnostics: LearnPreparationDiagnostics,
): LearnPreparationResult {
  return {
    kind: 'waiting',
    reason,
    statusText,
    diagnostics,
  }
}

/**
 * Product-level Learn entry controller.
 *
 * Both the React UI and system simulator must drive this orchestration rather
 * than reimplementing bootstrap/restore/due/acquisition priority.
 */
export async function prepareLearnSession<ErrorEvidence>(input: {
  dictId: string
  words: Word[]
  errorEvidence: ErrorEvidence[]
  dailyNewWordTarget?: number
  dependencies: LearnPreparationDependencies<ErrorEvidence>
}): Promise<LearnPreparationResult> {
  const { dictId, words, errorEvidence, dependencies } = input
  const now = dependencies.now()

  await dependencies.bootstrap(dictId, now)

  const unfinished = await dependencies.getLatestSession(dictId)
  if (unfinished) {
    const [wordRecords, wordStates] = await Promise.all([
      dependencies.getWordRecords(dictId),
      dependencies.getWordStates(dictId),
    ])
    const dailySession = ensureLearnDailySession({
      dict: dictId,
      now,
      dailyNewTarget: input.dailyNewWordTarget ?? 32,
      dictionaryWords: words.map((word) => word.name),
      wordRecords,
      wordStates,
    })

    return {
      kind: 'session',
      source: 'restored',
      record: unfinished,
      diagnostics: {
        now,
        dailySession,
      },
    }
  }

  const [wordRecords, wordStates] = await Promise.all([
    dependencies.getWordRecords(dictId),
    dependencies.getWordStates(dictId),
  ])
  const stats = buildLearnStatsSnapshot({
    now,
    dict: dictId,
    wordRecords,
    wordStates,
    dictionaryWords: words.map((word) => word.name),
  })
  const dailySession = ensureLearnDailySession({
    dict: dictId,
    now,
    dailyNewTarget: input.dailyNewWordTarget ?? 32,
    dictionaryWords: words.map((word) => word.name),
    wordRecords,
    wordStates,
  })

  if (dailySession.status === 'completed') {
    return wait(
      'daily-complete',
      '今日 Learn 目标已完成。',
      {
        now,
        stats,
        dailySession,
        allowedNewWordsNow: 0,
      },
    )
  }

  const quota = (dependencies.decideQuota ?? decideDailyAcquisitionQuota)(
    stats,
    undefined,
    dailySession.dailyNewTarget,
  )
  const dailyPlan =
    (dependencies.buildDailyPlan ?? buildLearnDailyPlan)({
      stats,
      quota,
    })

  if (dependencies.generateSession) {
    const session = await dependencies.generateSession(
      dictId,
      words,
      errorEvidence,
      dailyPlan.allowedNewWordsNow,
    )
    if (session) {
      const source: LearnPreparationSessionSource =
        session.sessionKind === 'mixed'
          ? 'mixed'
          : session.sessionKind === 'acquisition'
            ? 'acquisition'
            : 'review'
      return {
        kind: 'session',
        source,
        record: session,
        diagnostics: {
          now,
          stats,
          quota,
          allowedNewWordsNow: dailyPlan.allowedNewWordsNow,
          dailySession,
        },
      }
    }
  } else {
    // Compatibility path for non-product callers that have not adopted the
    // unified mixed-session generator yet.
    const dueReview = await dependencies.generateDueReview(
      dictId,
      words,
      errorEvidence,
    )
    if (dueReview) {
      return {
        kind: 'session',
        source: 'review',
        record: dueReview,
        diagnostics: {
          now,
          stats,
          quota,
          allowedNewWordsNow: dailyPlan.allowedNewWordsNow,
          dailySession,
        },
      }
    }
  }

  // Pending Acquisition completion is not fresh workload. The fresh allowance
  // only controls first introductions inside the acquisition resolver.
  const acquisition = dependencies.generateSession
    ? undefined
    : await dependencies.generateAcquisition(
        dictId,
        words,
        dailyPlan.allowedNewWordsNow,
      )
  if (acquisition) {
    return {
      kind: 'session',
      source: 'acquisition',
      record: acquisition,
      diagnostics: {
        now,
        stats,
        quota,
        allowedNewWordsNow: dailyPlan.allowedNewWordsNow,
        dailySession,
      },
    }
  }

  const nextResumeAt =
    await dependencies.getNextDeferredResumeAt(dictId)
  const diagnostics: LearnPreparationDiagnostics = {
    now,
    stats,
    quota,
    allowedNewWordsNow: dailyPlan.allowedNewWordsNow,
    ...(nextResumeAt !== undefined ? { nextResumeAt } : {}),
    dailySession,
  }

  if (nextResumeAt !== undefined && nextResumeAt > now) {
    const minutes = Math.max(
      1,
      Math.ceil((nextResumeAt - now) / 60),
    )
    return wait(
      'deferred',
      `还有新词需要稍后继续巩固，约 ${minutes} 分钟后可继续。`,
      diagnostics,
    )
  }

  if (stats.lifecycle.unseen === 0) {
    return wait(
      'empty',
      '当前词库没有需要学习的单词。',
      diagnostics,
    )
  }

  if (dailyPlan.action === 'review-due') {
    return wait(
      'review-due',
      '还有到期复习需要处理，暂不新增单词。',
      diagnostics,
    )
  }

  if (
    dailyPlan.reasonCodes.includes(
      'daily-workload-budget-reached',
    )
  ) {
    return wait(
      'workload-budget',
      `今日 Learn 工作量已完成（已投入约 ${dailyPlan.todayActiveMinutes} 分钟）。`,
      diagnostics,
    )
  }

  return wait(
    'quota',
    `今日新词额度已完成（已引入 ${stats.today.introducedWords}/${quota.targetDailyNewWords}）。`,
    diagnostics,
  )
}
