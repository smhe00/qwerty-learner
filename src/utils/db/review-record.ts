import { hasLearnRetrySpacing, planLearnContinuation } from '@/learn/continuation'
import { normalizeLearnBlockSize } from '@/learn/block-size'
import { db } from './core'
import { appendDeveloperTrace } from '@/dev/diagnostic-trace'
import { waitForBrowserFuzzGate } from '@/dev/browser-fuzz-hooks'
import { isAcquisitionIntroductionRecord } from '@/learn/admission'
import {
  collectPendingAcquisitionStates,
  repairUnadmittedAcquisitionCheckpoint,
} from '@/learn/acquisition-recovery'
import {
  deriveLearnExecutionProgress,
  getLearnExtraRoundNames,
  isLearnSessionOutsideExtraRound,
  learnLocalDateKey,
  loadLearnDailySession,
} from '@/learn/daily-session'
import {
  LEARN_NEW_WORD_BATCH_SIZE,
  buildLearnAcquisitionExercisePlans,
  buildLearnAcquisitionStates,
  canonicalizeLearningWords,
  planLearnAcquisitionCandidates,
  selectLearnMixedSessionItems,
  selectLearnSpacingWords,
  shouldRotateOversizedLearnSession,
} from '@/learn/session'
import {
  MIN_INDEPENDENT_INTERVENING_ITEMS,
  createLearnAcquisitionExercisePlanForState,
  createLearnAcquisitionState,
  deferredAcquisitionCohortResumeTimes,
  resumeDeferredAcquisition,
} from '@/learn/acquisition'
import type { LearnAcquisitionState } from '@/learn/acquisition'
import {
  sanitizeLearnSessionLifecycle,
} from '@/learn/lifecycle'
import { estimateLearnInteractionStrain } from '@/learn/strain'
import { ReviewRecord } from './record'
import { compactFinishedReviewRecord } from './review-record-retention'
import type { TErrorWordData } from '@/pages/Gallery-N/hooks/useErrorWords'
import { selectReviewCandidates } from '@/review/due'
import type { ReviewSelectionMode } from '@/review/due'
import { buildReviewSessionExercisePlans } from '@/review/session'
import { rankDueReviewCandidates } from '@/review/priority'
import {
  bootstrapReviewWordStatesForDictionary,
  getReviewWordStates,
} from '@/review/repository'
import type { Word } from '@/typings'
import { getUTCUnixTimestamp } from '@/utils'
import { useEffect, useState } from 'react'

export function useGetLatestReviewRecord(dictID: string) {
  const [wordReviewRecord, setWordReviewRecord] = useState<ReviewRecord | undefined>(undefined)
  useEffect(() => {
    const fetchWordReviewRecords = async () => {
      const record = await getLatestReviewRecord(dictID)
      setWordReviewRecord(record)
    }
    if (dictID) {
      fetchWordReviewRecords()
    }
  }, [dictID])
  return wordReviewRecord
}

export async function getLatestReviewRecord(dictID: string): Promise<ReviewRecord | undefined> {
  const records = await db.reviewRecords.where('dict').equals(dictID).toArray()

  // Session recovery is about the newest unfinished checkpoint, not the
  // newest historical record. A newer finished session must never hide an
  // older still-unfinished session.
  const latest = records
    .filter((record) => !record.isFinished)
    .sort((a, b) => a.createTime - b.createTime)
    .pop()

  if (!latest) return undefined
  if (isLearnSessionOutsideExtraRound(latest, loadLearnDailySession(dictID))) {
    await putWordReviewRecord({ ...latest, isFinished: true } as ReviewRecord)
    return undefined
  }

  // Checkpoint recovery is lifecycle-owned. Review keeps only ACTIVE words.
  // Acquisition keeps only words with no persistent lifecycle state, so a
  // checkpoint written just before admission/exclusion cannot replay work
  // that has already crossed the lifecycle boundary.
  const [states, wordRecords] = await Promise.all([
    getReviewWordStates(dictID),
    db.wordRecords.where('dict').equals(dictID).toArray(),
  ])
  const pending = collectPendingAcquisitionStates({ records, wordRecords, wordStates: states })
  const recovered = repairUnadmittedAcquisitionCheckpoint(latest, pending)
  const sanitized = sanitizeLearnSessionLifecycle(
    recovered,
    states,
  ) as ReviewRecord

  if (sanitized !== latest && latest.id !== undefined) {
    await putWordReviewRecord(sanitized)
  }

  if (shouldRotateOversizedLearnSession(sanitized)) {
    const rotated = {
      ...sanitized,
      isFinished: true,
    } as ReviewRecord
    await putWordReviewRecord(rotated)
    appendDeveloperTrace({
      scope: 'runtime',
      event: 'oversized-learn-session-rotated',
      sessionId: String(
        sanitized.id ?? sanitized.createTime,
      ),
      index: sanitized.index,
      queueLength: sanitized.words.length,
      details: {
        sessionKind: sanitized.sessionKind ?? 'legacy',
        reason: 'acquisition-cohort-over-20',
      },
    })
    return undefined
  }

  return sanitized.isFinished ? undefined : sanitized
}

export async function generateNewWordReviewRecord(
  dictID: string,
  errorData: TErrorWordData[],
  options?: { mode?: ReviewSelectionMode },
) {
  const now = getUTCUnixTimestamp()
  await bootstrapReviewWordStatesForDictionary(dictID, now)

  const states = await getReviewWordStates(dictID)
  const selectedErrorData = selectReviewCandidates(
    errorData,
    states,
    now,
    options?.mode ?? 'due',
  )
  const sortedWords: Word[] = rankDueReviewCandidates(
    selectedErrorData,
    states,
  ).map((item) => item.originData)

  if (sortedWords.length === 0) return undefined

  const wordRecords = await db.wordRecords.where('dict').equals(dictID).toArray()
  const exercisePlans = buildReviewSessionExercisePlans(sortedWords, wordRecords)
  const record = new ReviewRecord(dictID, sortedWords, exercisePlans)
  record.id = await db.reviewRecords.add(record)
  return record
}

export async function putWordReviewRecord(record: ReviewRecord) {
  await waitForBrowserFuzzGate('review-persistence')
  const id = await db.transaction(
    'rw',
    db.reviewRecords,
    async () => {
      if (record.id !== undefined) {
        const existing = await db.reviewRecords.get(record.id)
        if (existing?.isFinished && !record.isFinished) {
          return record.id
        }
      }
      return db.reviewRecords.put(compactFinishedReviewRecord(record))
    },
  )

  appendDeveloperTrace({
    scope: 'persistence',
    event: 'review-checkpoint-durable',
    sessionId: String(record.id ?? record.createTime),
    index: record.index,
    queueLength: record.words.length,
    details: {
      isFinished: record.isFinished,
    },
  })

  return id
}


export async function generateLearnReviewRecord(
  dictID: string,
  words: Word[],
  errorData: TErrorWordData[],
  options?: { mode?: ReviewSelectionMode; blockSize?: number },
) {
  const now = getUTCUnixTimestamp()
  await bootstrapReviewWordStatesForDictionary(dictID, now)

  const states = await getReviewWordStates(dictID)
  const errorByWord = new Map(
    errorData.map((item) => [item.word, item]),
  )

  const candidates = canonicalizeLearningWords(words).map((originData) => {
    const error = errorByWord.get(originData.name)
    return {
      word: originData.name,
      originData,
      errorCount: error?.errorCount ?? 0,
      latestErrorTime: error?.latestErrorTime ?? 0,
    }
  })

  const selected = selectReviewCandidates(
    candidates,
    states,
    now,
    options?.mode ?? 'due',
  )

  const sortedWords: Word[] = rankDueReviewCandidates(
    selected,
    states,
  ).map((item) => item.originData).slice(0, normalizeLearnBlockSize(options?.blockSize))

  if (sortedWords.length === 0) return undefined

  const wordRecords = await db.wordRecords.where('dict').equals(dictID).toArray()
  const exercisePlans = buildReviewSessionExercisePlans(sortedWords, wordRecords)
  const record = new ReviewRecord(
    dictID,
    sortedWords,
    exercisePlans,
    'review',
  )
  record.blockSize = normalizeLearnBlockSize(options?.blockSize)
  if ((options?.mode ?? 'due') === 'due') {
    record.recommendedGoal = {
      version: 1,
      kind: 'session-completion',
      targetUniqueWords: new Set(
        sortedWords.map((word) => word.name),
      ).size,
    }
  }
  record.id = await db.reviewRecords.add(record)
  return record
}

export async function generateLearnMixedSessionRecord(
  dictID: string,
  words: Word[],
  errorData: TErrorWordData[],
  freshLimit = LEARN_NEW_WORD_BATCH_SIZE,
  blockSize = LEARN_NEW_WORD_BATCH_SIZE,
) {
  const now = getUTCUnixTimestamp()
  await bootstrapReviewWordStatesForDictionary(dictID, now)

  const [states, pending, wordRecords] = await Promise.all([
    getReviewWordStates(dictID),
    getPendingAcquisitionStates(dictID),
    db.wordRecords.where('dict').equals(dictID).toArray(),
  ])

  const errorByWord = new Map(
    errorData.map((item) => [item.word, item]),
  )
  const reviewCandidates = canonicalizeLearningWords(words).map(
    (originData) => {
      const error = errorByWord.get(originData.name)
      return {
        word: originData.name,
        originData,
        errorCount: error?.errorCount ?? 0,
        latestErrorTime: error?.latestErrorTime ?? 0,
      }
    },
  )
  const dailySession = loadLearnDailySession(dictID)
  const extraNames = getLearnExtraRoundNames(dailySession)
  const plannedReviewNames =
    dailySession?.status === 'active'
      ? new Set(dailySession.plannedReviewWords.filter(name => !extraNames || extraNames.includes(name)))
      : null
  const completed = dailySession ? new Set(deriveLearnExecutionProgress({ session: dailySession, wordRecords }).independentCompletedWords) : new Set<string>()
  const continuation = dailySession?.status === 'active' && dailySession.continueUnfinishedPlan
    ? planLearnContinuation({ session: dailySession, words: canonicalizeLearningWords(words), states, records: wordRecords, now })
    : undefined
  const dueWords = continuation ? continuation.readyReviews : extraNames
    ? selectReviewCandidates(reviewCandidates, states, now, 'force')
        .map(item => item.originData)
        .filter(word => plannedReviewNames?.has(word.name) && !completed.has(word.name))
    : rankDueReviewCandidates(
        selectReviewCandidates(reviewCandidates, states, now, 'due'), states,
      ).map(item => item.originData).filter(word => plannedReviewNames === null || plannedReviewNames.has(word.name))


  const dailyProgress =
    dailySession?.status === 'active'
      ? deriveLearnExecutionProgress({
          session: dailySession,
          wordRecords,
        })
      : undefined
  const freshAllowance =
    dailySession?.status === 'active'
      ? Math.min(
          Math.max(0, Math.floor(freshLimit)),
          Math.max(
            0,
            (dailyProgress?.newTargetWords ?? dailySession.plannedNewWords) -
              (dailyProgress?.introducedNewWords ?? 0),
          ),
        )
      : Math.max(0, Math.floor(freshLimit))

  const candidatePlan = planLearnAcquisitionCandidates({
    words,
    states,
    pendingStates: pending,
    introducedWords: wordRecords
      .filter(isAcquisitionIntroductionRecord)
      .map((record) => record.word),
    freshLimit: freshAllowance,
    blockSize,
    allowedNewWordNames: getLearnExtraRoundNames(dailySession) ?? dailySession?.plannedNewWordNames,
    allowedAcquisitionNames: getLearnExtraRoundNames(dailySession) ?? (dailySession?.plannedNewWordNames
      ? [...dailySession.carryOverAcquisitionWords, ...dailySession.plannedNewWordNames]
      : undefined),
    continuous: (continuation?.spacingWords.length ?? dueWords.length) >= MIN_INDEPENDENT_INTERVENING_ITEMS,
    spacingCandidateNames: (continuation?.spacingWords ?? dueWords).map((word) => word.name),
    allowTerminalProbeOnIdle: !continuation && dueWords.length === 0,
    now,
  })
  const acquisitionCandidates: Array<{ word: Word; state?: LearnAcquisitionState; resumed: boolean; practice?: boolean }> = [
    ...candidatePlan.resumed.map(({ word, state }) => ({
      word,
      state,
      resumed: true as const,
    })),
    ...candidatePlan.freshWords.map((word) => ({
      word,
      state: undefined,
      resumed: false as const,
    })),
  ]

  const known = new Set([
    ...(dailySession?.plannedNewWordNames ?? []),
    ...(dailySession?.carryOverAcquisitionWords ?? []),
    ...states.map(state => state.word),
    ...wordRecords.filter(isAcquisitionIntroductionRecord).map(record => record.word),
    ...Array.from(pending.keys()),
  ])
  const optionalNewWords = canonicalizeLearningWords(words).filter(word => !known.has(word.name))
    .slice(0, normalizeLearnBlockSize(blockSize))
  // A cooling target keeps the plan open. Supply actual work rather than
  // forcing an early probe or routing the learner through "five more".
  if (continuation && (dailyProgress?.remainingWords ?? 0) > 0 &&
      dueWords.length === 0 && acquisitionCandidates.length === 0) {
    const practice = continuation.spacingWords.slice(0, MIN_INDEPENDENT_INTERVENING_ITEMS)
    const fresh = optionalNewWords.slice(0, Math.max(0, MIN_INDEPENDENT_INTERVENING_ITEMS - practice.length))
    if (practice.length + fresh.length >= MIN_INDEPENDENT_INTERVENING_ITEMS) acquisitionCandidates.push(
      ...practice.map(word => ({ word, state: { ...createLearnAcquisitionState(), spacingOnly: true }, resumed: true, practice: true })),
      ...fresh.map(word => ({ word, resumed: false })),
    )
  }

  const selection = selectLearnMixedSessionItems({
    blockSize,
    dueWords,
    acquisitionWords: acquisitionCandidates.map(
      (item) => item.word,
    ),
  })
  const {
    selectedReviewWords,
    selectedAcquisitionWords,
    selectedWords,
    sessionKind,
    itemKinds,
  } = selection
  const selectedAcquisition = acquisitionCandidates.slice(
    0,
    selectedAcquisitionWords.length,
  )

  if (selectedWords.length === 0) return undefined

  const scaffoldStrainTier =
    estimateLearnInteractionStrain(wordRecords).tier
  const freshWords = selectedAcquisition
    .filter((item) => !item.resumed)
    .map((item) => item.word)
  const resumed = selectedAcquisition.filter(
    (item): item is typeof item & {
      state: LearnAcquisitionState
      resumed: true
    } => item.resumed && item.state !== undefined,
  )

  const reviewPlans = buildReviewSessionExercisePlans(
    selectedReviewWords,
    wordRecords,
  )
  const acquisitionPlans = {
    ...buildLearnAcquisitionExercisePlans(freshWords, {
      scaffoldStrainTier,
    }),
    ...Object.fromEntries(
      resumed.map(({ word, state }) => [
        word.name,
        createLearnAcquisitionExercisePlanForState(state),
      ]),
    ),
  }
  const acquisitionStates = {
    ...buildLearnAcquisitionStates(freshWords, {
      scaffoldStrainTier,
    }),
    ...Object.fromEntries(
      resumed.map(({ word, state }) => [word.name, state]),
    ),
  }

  const hasAcquisition = selectedAcquisitionWords.length > 0

  const record = new ReviewRecord(
    dictID,
    selectedWords,
    {
      ...reviewPlans,
      ...acquisitionPlans,
    },
    sessionKind,
  )
  // Optional introductions supply real intervening work, but never expand the frozen target.
  if (dailySession?.status === 'active' && dailySession.plannedNewWordNames && !getLearnExtraRoundNames(dailySession)) {
    record.optionalNewWords = optionalNewWords
  }
  record.blockSize = normalizeLearnBlockSize(blockSize)
  record.itemKinds = itemKinds
  if (hasAcquisition) {
    record.acquisitionStates = acquisitionStates
    record.spacingWords = selectLearnSpacingWords({
      words: continuation?.spacingWords ?? dueWords,
      states,
      excludedNames: selectedWords.map((word) => word.name),
    })
  }
  const targetWords = selectedWords.filter(word => !acquisitionStates[word.name]?.spacingOnly &&
    !optionalNewWords.some(optional => optional.name === word.name))
  if (targetWords.length > 0) record.recommendedGoal = {
    version: 1,
    kind: 'session-completion',
    targetUniqueWords: new Set(targetWords.map(word => word.name)).size,
  }
  record.id = await db.reviewRecords.add(record)
  return record
}


async function getPendingAcquisitionStates(
  dictID: string,
): Promise<Map<string, LearnAcquisitionState>> {
  const [records, wordStates, wordRecords] = await Promise.all([
    db.reviewRecords.where('dict').equals(dictID).toArray(),
    getReviewWordStates(dictID),
    db.wordRecords.where('dict').equals(dictID).toArray(),
  ])
  const pending = collectPendingAcquisitionStates({ records, wordRecords, wordStates })
  const daily = loadLearnDailySession(dictID)
  // Actual interleaving can satisfy the delay even when new filler words
  // have not themselves reached admission. Reload alone supplies no credit.
  for (const [name, state] of Array.from(pending)) {
    const now = getUTCUnixTimestamp()
    if (daily?.continueUnfinishedPlan && state.phase === 'deferred' &&
        wordRecords.some(record => record.word === name && record.sourceMode === 'learn') &&
        hasLearnRetrySpacing(name, wordRecords, now)) {
      const resumed = resumeDeferredAcquisition({
        ...state, terminalProbe: undefined, terminalProbeAttemptedAt: undefined, resumeAfter: now,
      }, now)
      if (resumed) pending.set(name, resumed)
      continue
    }
    if (state.terminalProbeAttemptedAt !== undefined &&
        ((daily?.continueUnfinishedPlan && hasLearnRetrySpacing(name, wordRecords, getUTCUnixTimestamp())) ||
        (daily?.extraRoundStartedAt && daily.extraRoundWordNames?.includes(name) && state.terminalProbeAttemptedAt < daily.extraRoundStartedAt))) {
      pending.set(name, { ...state, terminalProbeAttemptedAt: undefined })
    }
  }
  return pending
}

async function getDeferredAcquisitionStates(
  dictID: string,
): Promise<Map<string, LearnAcquisitionState>> {
  const pending = await getPendingAcquisitionStates(dictID)
  const daily = loadLearnDailySession(dictID)
  const frozen = daily?.status === 'active' && daily.plannedNewWordNames
    ? new Set(getLearnExtraRoundNames(daily) ?? [...daily.carryOverAcquisitionWords, ...daily.plannedNewWordNames])
    : undefined
  return new Map(
    [...pending].filter(
      ([word, state]) =>
        (!frozen || frozen.has(word)) &&
        state.phase === 'deferred' &&
        state.resumeAfter !== undefined,
    ),
  )
}

export async function getNextDeferredAcquisitionResumeAt(
  dictID: string,
): Promise<number | undefined> {
  const deferred = await getDeferredAcquisitionStates(dictID)
  const today = learnLocalDateKey(getUTCUnixTimestamp())
  const eligible = new Map([...deferred].filter(([, state]) =>
    state.terminalProbeAttemptedAt === undefined ||
    learnLocalDateKey(state.terminalProbeAttemptedAt) !== today,
  ))
  const resumeTimes = [...deferredAcquisitionCohortResumeTimes(eligible).values()]

  return resumeTimes.length > 0 ? Math.min(...resumeTimes) : undefined
}

/**
 * Compatibility alias. Pending recovery now includes both spacing and
 * assistance deferrals.
 */
export async function getNextSpacingDeferredResumeAt(
  dictID: string,
): Promise<number | undefined> {
  return getNextDeferredAcquisitionResumeAt(dictID)
}

export async function generateNewWordAcquisitionRecord(
  dictID: string,
  words: Word[],
  limit = LEARN_NEW_WORD_BATCH_SIZE,
  blockSize = LEARN_NEW_WORD_BATCH_SIZE,
) {
  const requestedFreshLimit = Math.max(0, Math.floor(limit))
  const now = getUTCUnixTimestamp()
  const [states, pending, wordRecords] = await Promise.all([
    getReviewWordStates(dictID),
    getPendingAcquisitionStates(dictID),
    db.wordRecords.where('dict').equals(dictID).toArray(),
  ])
  const scaffoldStrainTier =
    estimateLearnInteractionStrain(wordRecords).tier
  const dailySession = loadLearnDailySession(dictID)
  const dailyProgress =
    dailySession?.status === 'active'
      ? deriveLearnExecutionProgress({
          session: dailySession,
          wordRecords,
        })
      : undefined
  const freshLimit =
    dailySession?.status === 'active'
      ? Math.min(
          requestedFreshLimit,
          Math.max(
            0,
            (dailyProgress?.newTargetWords ?? dailySession.plannedNewWords) -
              (dailyProgress?.introducedNewWords ?? 0),
          ),
        )
      : requestedFreshLimit

  const candidatePlan = planLearnAcquisitionCandidates({
    words,
    states,
    pendingStates: pending,
    introducedWords: wordRecords
      .filter(isAcquisitionIntroductionRecord)
      .map((record) => record.word),
    freshLimit,
    blockSize,
    allowedNewWordNames: getLearnExtraRoundNames(dailySession) ?? dailySession?.plannedNewWordNames,
    allowedAcquisitionNames: getLearnExtraRoundNames(dailySession) ?? (dailySession?.plannedNewWordNames
      ? [...dailySession.carryOverAcquisitionWords, ...dailySession.plannedNewWordNames]
      : undefined),
    continuous: false,
    allowTerminalProbeOnIdle: true,
    now,
  })
  const { resumed, freshWords } = candidatePlan

  const selectedWords = [
    ...resumed.map((item) => item.word),
    ...freshWords,
  ]
  if (selectedWords.length === 0) return undefined

  const exercisePlans = {
    ...buildLearnAcquisitionExercisePlans(freshWords, {
      scaffoldStrainTier,
    }),
    ...Object.fromEntries(
      resumed.map(({ word, state }) => [
        word.name,
        createLearnAcquisitionExercisePlanForState(state),
      ]),
    ),
  }
  const acquisitionStates = {
    ...buildLearnAcquisitionStates(freshWords, {
      scaffoldStrainTier,
    }),
    ...Object.fromEntries(
      resumed.map(({ word, state }) => [word.name, state]),
    ),
  }

  const record = new ReviewRecord(
    dictID,
    selectedWords,
    exercisePlans,
    'acquisition',
  )
  record.blockSize = normalizeLearnBlockSize(blockSize)
  record.acquisitionStates = acquisitionStates
  record.spacingWords = []
  record.recommendedGoal = {
    version: 1,
    kind: 'session-completion',
    targetUniqueWords: new Set(
      selectedWords.map((word) => word.name),
    ).size,
  }
  record.id = await db.reviewRecords.add(record)
  return record
}
