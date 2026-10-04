import {
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
  LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
  createLearnAcquisitionState,
  resumeSpacingDeferredAcquisition,
  type LearnAcquisitionState,
} from '../../src/learn/acquisition'
import {
  isAcquisitionIntroductionRecord,
} from '../../src/learn/admission'
import { buildLearnDailyPlan } from '../../src/learn/plan'
import { decideDailyAcquisitionQuota } from '../../src/learn/quota'
import {
  prepareLearnSession,
  type LearnPreparationDependencies,
  type LearnPreparationResult,
} from '../../src/learn/controller'
import { resolveLearnAcquisitionCompletion } from '../../src/learn/progression'
import {
  buildLearnAcquisitionStates,
  planLearnAcquisitionCandidates,
} from '../../src/learn/session'
import { selectReviewCandidates } from '../../src/review/due'
import { resolveReviewCompletion } from '../../src/review/progression'
import { scheduleBasicReview } from '../../src/review/scheduler'
import { getReviewAttemptRole } from '../../src/review/session'
import { createInitialReviewWordState } from '../../src/review/types'
import type { IReviewWordState } from '../../src/review/types'
import type { Word } from '../../src/typings'
import type {
  IWordRecord,
  ReviewRecord,
} from '../../src/utils/db/record'
import {
  preparationResultToTraceEvent,
  type LearnSystemTraceEvent,
} from './system-oracle'

const DAY_SECONDS = 86_400

export type VirtualLearnMutation = {
  quotaAccounting?: 'production' | 'acquired'
  dropProjectionAtInteraction?: number
  staleRestoreOnce?: boolean
  bypassDueFirst?: boolean
  strandReadyDeferred?: boolean
}

type StoredSession = ReviewRecord

function clone<T>(value: T): T {
  return structuredClone(value)
}

function queueSignature(words: Word[]): string {
  return words.map((word) => word.name).join('|')
}

function acquisitionStateSignature(
  state: LearnAcquisitionState | undefined,
): string {
  if (!state) return 'missing'
  return [
    state.phase,
    state.assistedCycles,
    state.independentInterveningItems ?? -1,
    state.deferredReason ?? 'none',
    state.resumeAfter ?? -1,
  ].join(':')
}

type VirtualReviewOutcome = 'good' | 'hard' | 'again'

function makeReviewRecord(input: {
  id: number
  word: string
  now: number
  outcome: VirtualReviewOutcome
  attemptRole: 'cold' | 'reinforcement'
}): IWordRecord {
  const wrongCount =
    input.outcome === 'again'
      ? 2
      : input.outcome === 'hard'
        ? 1
        : 0
  const eligible = input.attemptRole === 'cold'
  return {
    id: input.id,
    word: input.word,
    timeStamp: input.now,
    dict: 'simulation',
    chapter: -1,
    timing: [600],
    wrongCount,
    mistakes:
      wrongCount > 0
        ? { 0: ['x'] }
        : {},
    sourceMode: 'learn',
    learnItemKind: 'review',
    reviewRatingDecision: eligible
      ? {
          eligible: true,
          rating: input.outcome,
          confidence: 1,
          reasonCodes: ['simulation-cold-review'],
        }
      : {
          eligible: false,
          rating: null,
          reason: 'non-cold-attempt',
          reasonCodes: ['simulation-reinforcement'],
        },
    reviewEvidence: {
      version: 1,
      memoryGrade: input.outcome,
      errorCause:
        input.outcome === 'again'
          ? 'recall'
          : input.outcome === 'hard'
            ? 'spelling'
            : 'clean',
      confidence: 1,
      retrievalValidity: 'independent',
      evidenceStrength: 1,
      reasonCodes: ['simulation-review'],
    },
  }
}

function makeAcquisitionRecord(input: {
  id: number
  word: string
  now: number
  policyVersion: string
  spacingEligible?: boolean
  wrongCount?: number
}): IWordRecord {
  const wrongCount = input.wrongCount ?? 0
  return {
    id: input.id,
    word: input.word,
    timeStamp: input.now,
    dict: 'simulation',
    chapter: -1,
    timing: [500],
    wrongCount,
    mistakes: wrongCount > 0 ? { 0: ['x'] } : {},
    sourceMode: 'learn',
    learnItemKind: 'acquisition',
    reviewPolicyDecision: {
      version: 1,
      policyVersion: input.policyVersion,
      reasonCodes: input.spacingEligible
        ? ['spacing-eligible']
        : ['simulation-training'],
      conditionVersion: 1,
    },
    ...(input.policyVersion ===
      LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION
      ? {
          reviewEvidence: {
            version: 1 as const,
            memoryGrade:
              wrongCount > 0 ? ('again' as const) : ('good' as const),
            errorCause:
              wrongCount > 0 ? ('recall' as const) : ('clean' as const),
            confidence: 1,
            retrievalValidity: 'independent' as const,
            evidenceStrength: 1,
            reasonCodes: ['simulation-clean'],
          },
        }
      : {}),
  }
}

export class VirtualLearnApp {
  readonly words: Word[]
  readonly events: LearnSystemTraceEvent[] = []
  readonly wordRecords: IWordRecord[] = []
  readonly wordStates: IReviewWordState[] = []

  now: number
  private sessions: StoredSession[] = []
  private activeSessionId: number | undefined
  private nextSessionId = 1
  private nextWordRecordId = 1
  private interactionCount = 0
  private staleCheckpoint: StoredSession | undefined
  private mutation: VirtualLearnMutation
  private staleRestoreConsumed = false

  constructor(input: {
    words: Word[]
    now?: number
    mutation?: VirtualLearnMutation
  }) {
    this.words = clone(input.words)
    this.now =
      input.now ??
      Math.floor(
        new Date(2026, 9, 4, 8, 0, 0).getTime() / 1000,
      )
    this.mutation = input.mutation ?? {}
  }

  seedAdmittedWords(count: number) {
    const bounded = Math.min(
      Math.max(0, Math.floor(count)),
      this.words.length,
    )

    for (let index = 0; index < bounded; index += 1) {
      const word = this.words[index]
      if (
        this.wordStates.some(
          (state) => state.word === word.name,
        )
      ) {
        continue
      }

      this.wordRecords.push(
        makeAcquisitionRecord({
          id: this.nextWordRecordId++,
          word: word.name,
          now: this.now - bounded + index,
          policyVersion:
            LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
          spacingEligible: true,
        }),
      )
      const state = createInitialReviewWordState(
        'simulation',
        word.name,
        this.now - bounded + index,
      )
      state.nextReviewAt = this.now + DAY_SECONDS
      this.wordStates.push(state)
    }
  }

  makeSeededWordsDue(count = this.wordStates.length) {
    const bounded = Math.min(
      Math.max(0, Math.floor(count)),
      this.wordStates.length,
    )
    for (let index = 0; index < bounded; index += 1) {
      this.wordStates[index].nextReviewAt = this.now
    }
  }

  seedDeferredAcquisition(input?: {
    wordIndex?: number
    reason?: 'assistance' | 'spacing'
    ready?: boolean
  }) {
    const wordIndex = input?.wordIndex ?? 0
    const target = this.words[wordIndex]
    if (!target) {
      throw new Error('deferred seed word index out of range')
    }

    const reason = input?.reason ?? 'assistance'
    const ready = input?.ready ?? true
    const deferredState: LearnAcquisitionState = {
      ...createLearnAcquisitionState(),
      phase: 'deferred',
      assistedCycles: reason === 'assistance' ? 2 : 0,
      deferredReason: reason,
      resumeAfter: ready ? this.now : this.now + 300,
    }

    this.wordRecords.push(
      makeAcquisitionRecord({
        id: this.nextWordRecordId++,
        word: target.name,
        now: this.now - 1,
        policyVersion:
          LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
      }),
    )

    const session: ReviewRecord = {
      id: this.nextSessionId++,
      dict: 'simulation',
      index: 0,
      createTime: this.now - 1,
      isFinished: true,
      words: [clone(target)],
      sessionKind: 'acquisition',
      acquisitionStates: {
        [target.name]: deferredState,
      },
    } as ReviewRecord
    this.sessions.push(clone(session))
  }

  private sessionById(id: number | undefined) {
    if (id === undefined) return undefined
    return this.sessions.find((session) => session.id === id)
  }

  private latestUnfinishedSession(): StoredSession | undefined {
    if (
      this.mutation.staleRestoreOnce &&
      !this.staleRestoreConsumed &&
      this.staleCheckpoint
    ) {
      this.staleRestoreConsumed = true
      return clone(this.staleCheckpoint)
    }

    const unfinished = this.sessions
      .filter((session) => !session.isFinished)
      .sort((a, b) => a.createTime - b.createTime)
      .at(-1)
    if (!unfinished) return undefined

    return clone(unfinished)
  }

  private latestPendingAcquisitionStates() {
    const latest = new Map<string, LearnAcquisitionState>()

    for (const session of [...this.sessions].sort(
      (a, b) => a.createTime - b.createTime,
    )) {
      if (session.sessionKind !== 'acquisition') continue
      for (const [word, state] of Object.entries(
        session.acquisitionStates ?? {},
      )) {
        latest.set(word, state)
      }
    }

    const admitted = new Set(
      this.wordStates.map((state) => state.word),
    )
    return new Map(
      [...latest].filter(
        ([word, state]) =>
          !admitted.has(word) && state.phase !== 'complete',
      ),
    )
  }

  private generateAcquisition = async (
    _dictId: string,
    words: Word[],
    freshLimit: number,
  ): Promise<ReviewRecord | undefined> => {
    const pending = this.latestPendingAcquisitionStates()
    const plannerPending =
      this.mutation.strandReadyDeferred
        ? new Map(
            [...pending].filter(([, state]) => {
              const isReadyDeferred =
                state.phase === 'deferred' &&
                state.resumeAfter !== undefined &&
                state.resumeAfter <= this.now
              return !isReadyDeferred
            }),
          )
        : pending
    const introduced = this.wordRecords
      .filter(isAcquisitionIntroductionRecord)
      .map((record) => record.word)

    const candidatePlan = planLearnAcquisitionCandidates({
      words,
      states: this.wordStates,
      pendingStates: plannerPending,
      introducedWords: introduced,
      freshLimit,
      now: this.now,
    })
    const selected = [
      ...candidatePlan.resumed.map((item) => item.word),
      ...candidatePlan.freshWords,
    ]
    if (selected.length === 0) return undefined

    const freshStates = buildLearnAcquisitionStates(
      candidatePlan.freshWords,
    )
    const acquisitionStates = {
      ...freshStates,
      ...Object.fromEntries(
        candidatePlan.resumed.map(({ word, state }) => [
          word.name,
          state,
        ]),
      ),
    }

    const session: ReviewRecord = {
      id: this.nextSessionId++,
      dict: 'simulation',
      index: 0,
      createTime: this.now,
      isFinished: false,
      words: clone(selected),
      sessionKind: 'acquisition',
      acquisitionStates,
      recommendedGoal: {
        version: 1,
        kind: 'session-completion',
        targetUniqueWords: new Set(
          selected.map((word) => word.name),
        ).size,
      },
    } as ReviewRecord
    this.sessions.push(clone(session))
    return clone(session)
  }

  private generateDueReview = async (
    _dictId: string,
    words: Word[],
  ): Promise<ReviewRecord | undefined> => {
    const selected = selectReviewCandidates(
      words.map((word) => ({
        word: word.name,
        originData: word,
      })),
      this.wordStates,
      this.now,
      'due',
    ).map((item) => item.originData)

    if (selected.length === 0) return undefined

    const session: ReviewRecord = {
      id: this.nextSessionId++,
      dict: 'simulation',
      index: 0,
      createTime: this.now,
      isFinished: false,
      words: clone(selected),
      sessionKind: 'review',
    } as ReviewRecord
    this.sessions.push(clone(session))
    return clone(session)
  }

  private dependencies(): LearnPreparationDependencies<never> {
    return {
      now: () => this.now,
      bootstrap: async () => undefined,
      getLatestSession: async () => this.latestUnfinishedSession(),
      generateDueReview: this.mutation.bypassDueFirst
        ? async () => undefined
        : this.generateDueReview,
      getWordRecords: async () => clone(this.wordRecords),
      getWordStates: async () => clone(this.wordStates),
      generateAcquisition: this.generateAcquisition,
      getNextDeferredResumeAt: async () => {
        const resumeTimes = [
          ...this.latestPendingAcquisitionStates().values(),
        ]
          .filter(
            (state) =>
              state.phase === 'deferred' &&
              state.resumeAfter !== undefined,
          )
          .map((state) => state.resumeAfter)
          .filter(
            (value): value is number => value !== undefined,
          )
        return resumeTimes.length > 0
          ? Math.min(...resumeTimes)
          : undefined
      },
      ...(this.mutation.bypassDueFirst
        ? {
            buildDailyPlan: ({ stats, quota }) =>
              buildLearnDailyPlan({
                stats: {
                  ...stats,
                  lifecycle: {
                    ...stats.lifecycle,
                    due: 0,
                    difficultDue: 0,
                  },
                },
                quota,
              }),
          }
        : {}),
      ...(this.mutation.quotaAccounting === 'acquired'
        ? {
            decideQuota: (stats) => {
              const baseline =
                decideDailyAcquisitionQuota(stats)
              const remaining = Math.max(
                0,
                baseline.targetDailyNewWords -
                  stats.today.acquiredWords,
              )
              const bounded =
                stats.lifecycle.unseen === null
                  ? remaining
                  : Math.min(remaining, stats.lifecycle.unseen)
              return {
                ...baseline,
                remainingDailyNewWords: bounded,
                allowedNow:
                  stats.lifecycle.due > 0 ? 0 : bounded,
              }
            },
          }
        : {}),
    }
  }

  async enter(): Promise<LearnPreparationResult> {
    const result = await prepareLearnSession({
      dictId: 'simulation',
      words: this.words,
      errorEvidence: [],
      dependencies: this.dependencies(),
    })
    this.events.push(preparationResultToTraceEvent(result))

    const pendingAfterPrepare =
      this.latestPendingAcquisitionStates()
    this.events.push({
      kind: 'acquisition-health',
      now: this.now,
      opportunity:
        result.kind === 'session'
          ? result.source === 'acquisition'
          : result.reason !== 'review-due',
      pending: [...pendingAfterPrepare].map(([word, state]) => ({
        word,
        phase: state.phase,
        deferredReason: state.deferredReason ?? null,
        resumeAfter: state.resumeAfter ?? null,
      })),
    })

    if (result.kind === 'session') {
      this.activeSessionId = result.record.id

      const restored = result.source === 'restored'
      if (restored && result.record.id !== undefined) {
        const stored = this.sessionById(result.record.id)
        if (stored) {
          this.events.push({
            kind: 'checkpoint',
            action: 'restore',
            sessionId: `id:${result.record.id}`,
            index: result.record.index,
            isFinished: result.record.isFinished,
            queueSignature: queueSignature(result.record.words),
            wordCount: result.record.words.length,
          })
        }
      }
    } else {
      this.activeSessionId = undefined
    }

    return result
  }

  exit() {
    this.activeSessionId = undefined
  }

  refresh() {
    this.exit()
    return this.enter()
  }

  advanceSeconds(seconds: number) {
    this.now += Math.max(0, seconds)
  }

  advanceDays(days: number) {
    this.advanceSeconds(days * DAY_SECONDS)
  }

  private persistSession(session: StoredSession) {
    const index = this.sessions.findIndex(
      (item) => item.id === session.id,
    )
    if (index < 0) {
      this.sessions.push(clone(session))
    } else {
      this.sessions[index] = clone(session)
    }

    if (session.id !== undefined) {
      this.events.push({
        kind: 'checkpoint',
        action: 'save',
        sessionId: `id:${session.id}`,
        index: session.index,
        isFinished: session.isFinished,
        queueSignature: queueSignature(session.words),
        wordCount: session.words.length,
      })
    }
  }

  completeCurrentReview(
    outcome: VirtualReviewOutcome = 'good',
  ): boolean {
    const session = this.sessionById(this.activeSessionId)
    if (
      !session ||
      session.sessionKind !== 'review' ||
      session.isFinished
    ) {
      return false
    }

    const currentWord = session.words[session.index]
    if (!currentWord) return false
    const reinforcementUsed =
      session.reinforcementCounts?.[currentWord.name] ?? 0
    const attemptRole = getReviewAttemptRole({
      sessionKind: 'review',
      reinforcementUsed,
    })
    if (!attemptRole) return false

    const beforeIndex = session.index
    const beforeQueue = queueSignature(session.words)
    const beforeItemStateSignature = JSON.stringify(
      session.itemStates?.[currentWord.name] ?? null,
    )
    const isCold = attemptRole === 'cold'
    const ratingDecision = isCold
      ? {
          eligible: true as const,
          rating: outcome,
          confidence: 1,
          reasonCodes: ['simulation-cold-review'],
        }
      : {
          eligible: false as const,
          rating: null,
          reason: 'non-cold-attempt' as const,
          reasonCodes: ['simulation-reinforcement'],
        }
    const wrongCount =
      outcome === 'again'
        ? 2
        : outcome === 'hard'
          ? 1
          : 0
    const classification = {
      cause:
        outcome === 'again'
          ? ('recall' as const)
          : outcome === 'hard'
            ? ('spelling' as const)
            : ('clean' as const),
      confidence: 1,
      scores: {
        recall: outcome === 'again' ? 1 : 0,
        spelling: outcome === 'hard' ? 1 : 0,
        motor: 0,
      },
    }
    const resolution = resolveReviewCompletion({
      queue: session.words,
      currentIndex: session.index,
      currentWord,
      ratingDecision,
      attemptRole,
      wrongCount,
      classification,
      exercisePlans: session.exercisePlans,
      reinforcementCounts: session.reinforcementCounts,
      itemStates: session.itemStates,
    })

    this.interactionCount += 1
    const shouldDrop =
      this.mutation.dropProjectionAtInteraction ===
      this.interactionCount

    if (!shouldDrop) {
      session.index = resolution.projection.index
      session.words = clone(resolution.projection.queue)
      session.isFinished = resolution.projection.isFinished
    }
    session.exercisePlans = clone(resolution.exercisePlans)
    session.reinforcementCounts = clone(
      resolution.reinforcementCounts,
    )
    session.itemStates = clone(resolution.itemStates)

    this.wordRecords.push(
      makeReviewRecord({
        id: this.nextWordRecordId++,
        word: currentWord.name,
        now: this.now,
        outcome,
        attemptRole,
      }),
    )

    const stateIndex = this.wordStates.findIndex(
      (state) => state.word === currentWord.name,
    )
    if (stateIndex >= 0 && isCold) {
      this.wordStates[stateIndex] = scheduleBasicReview({
        state: this.wordStates[stateIndex],
        outcome,
        now: this.now,
      })
    }

    this.persistSession(session)
    this.events.push({
      kind: 'attempt-completed',
      sessionKind: 'review',
      word: currentWord.name,
      success: outcome !== 'again',
      beforeIndex,
      afterIndex: session.index,
      expectedAfterIndex: resolution.projection.index,
      beforeQueueSignature: beforeQueue,
      afterQueueSignature: queueSignature(session.words),
      expectedAfterQueueSignature: queueSignature(
        resolution.projection.queue,
      ),
      beforeItemStateSignature,
      afterItemStateSignature: JSON.stringify(
        session.itemStates?.[currentWord.name] ?? null,
      ),
      afterFinished: session.isFinished,
      expectedAfterFinished: resolution.projection.isFinished,
    })

    return true
  }

  completeCurrentAcquisitionClean(): boolean {
    return this.completeCurrentAcquisitionAttempt({
      wrongCount: 0,
      cause: 'clean',
    })
  }

  completeCurrentReviewClean(): boolean {
    return this.completeCurrentReview('good')
  }

  completeCurrentClean(): boolean {
    const session = this.sessionById(this.activeSessionId)
    if (!session) return false
    return session.sessionKind === 'review'
      ? this.completeCurrentReview('good')
      : this.completeCurrentAcquisitionClean()
  }

  completeCurrentAttempt(
    outcome: VirtualReviewOutcome,
  ): boolean {
    const session = this.sessionById(this.activeSessionId)
    if (!session) return false
    if (session.sessionKind === 'review') {
      return this.completeCurrentReview(outcome)
    }

    return this.completeCurrentAcquisitionAttempt({
      wrongCount:
        outcome === 'again'
          ? 2
          : outcome === 'hard'
            ? 1
            : 0,
      cause:
        outcome === 'again'
          ? 'recall'
          : outcome === 'hard'
            ? 'spelling'
            : 'clean',
    })
  }

  completeCurrentAcquisitionAttempt(input: {
    wrongCount: number
    cause: 'clean' | 'recall' | 'spelling'
  }): boolean {
    const session = this.sessionById(this.activeSessionId)
    if (
      !session ||
      session.sessionKind !== 'acquisition' ||
      session.isFinished
    ) {
      return false
    }

    const currentWord = session.words[session.index]
    if (!currentWord) return false
    const currentState =
      session.acquisitionStates?.[currentWord.name] ??
      createLearnAcquisitionState()

    if (
      currentState.phase === 'complete' ||
      currentState.phase === 'deferred'
    ) {
      return false
    }

    if (currentState.phase === 'exposure') {
      this.wordRecords.push(
        makeAcquisitionRecord({
          id: this.nextWordRecordId++,
          word: currentWord.name,
          now: this.now,
          policyVersion:
            LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
        }),
      )
    }

    const beforeIndex = session.index
    const beforeQueue = queueSignature(session.words)
    const beforeState =
      acquisitionStateSignature(currentState)
    const resolution = resolveLearnAcquisitionCompletion({
      queue: session.words,
      currentIndex: session.index,
      currentWord,
      state: currentState,
      acquisitionStates:
        session.acquisitionStates ?? {},
      wrongCount: input.wrongCount,
      classificationCause: input.cause,
      retrievalValidity: 'independent',
      now: this.now,
    })

    this.interactionCount += 1
    const shouldDrop =
      this.mutation.dropProjectionAtInteraction ===
      this.interactionCount

    const expected = resolution.projection
    if (!shouldDrop) {
      session.index = expected.index
      session.words = clone(expected.queue)
      session.isFinished = expected.isFinished
    }
    session.acquisitionStates =
      clone(resolution.acquisitionStates)

    if (currentState.phase === 'independent') {
      this.wordRecords.push(
        makeAcquisitionRecord({
          id: this.nextWordRecordId++,
          word: currentWord.name,
          now: this.now,
          policyVersion:
            LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
          spacingEligible:
            resolution.shouldPersistAdmission,
          wrongCount: input.wrongCount,
        }),
      )
    }

    if (resolution.shouldPersistAdmission) {
      if (
        !this.wordStates.some(
          (state) => state.word === currentWord.name,
        )
      ) {
        const state = createInitialReviewWordState(
          'simulation',
          currentWord.name,
          this.now,
        )
        state.nextReviewAt = this.now + DAY_SECONDS
        this.wordStates.push(state)
      }
    }

    if (
      resolution.nextState.phase === 'deferred' &&
      resolution.nextState.deferredReason === 'spacing'
    ) {
      const resumed = resumeSpacingDeferredAcquisition(
        resolution.nextState,
        this.now,
      )
      if (resumed) {
        session.acquisitionStates[currentWord.name] =
          resumed
      }
    }

    this.persistSession(session)

    this.events.push({
      kind: 'attempt-completed',
      sessionKind: 'acquisition',
      word: currentWord.name,
      success: input.wrongCount === 0,
      beforeIndex,
      afterIndex: session.index,
      expectedAfterIndex: expected.index,
      beforeQueueSignature: beforeQueue,
      afterQueueSignature: queueSignature(session.words),
      expectedAfterQueueSignature:
        queueSignature(expected.queue),
      beforeItemStateSignature: beforeState,
      afterItemStateSignature:
        acquisitionStateSignature(
          session.acquisitionStates?.[
            currentWord.name
          ],
        ),
      afterFinished: session.isFinished,
      expectedAfterFinished: expected.isFinished,
    })

    return true
  }

  snapshot() {
    return {
      now: this.now,
      sessions: clone(this.sessions),
      wordRecords: clone(this.wordRecords),
      wordStates: clone(this.wordStates),
      activeSessionId: this.activeSessionId,
      events: clone(this.events),
    }
  }

  seedStaleCheckpointFromActive() {
    const active = this.sessionById(this.activeSessionId)
    if (active) this.staleCheckpoint = clone(active)
  }
}

