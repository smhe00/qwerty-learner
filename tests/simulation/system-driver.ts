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

function makeAcquisitionRecord(input: {
  id: number
  word: string
  now: number
  policyVersion: string
  spacingEligible?: boolean
}): IWordRecord {
  return {
    id: input.id,
    word: input.word,
    timeStamp: input.now,
    dict: 'simulation',
    chapter: -1,
    timing: [500],
    wrongCount: 0,
    mistakes: {},
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
            memoryGrade: 'good' as const,
            errorCause: 'clean' as const,
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

  private sessionById(id: number | undefined) {
    if (id === undefined) return undefined
    return this.sessions.find((session) => session.id === id)
  }

  private latestUnfinishedSession(): StoredSession | undefined {
    const unfinished = this.sessions
      .filter((session) => !session.isFinished)
      .sort((a, b) => a.createTime - b.createTime)
      .at(-1)
    if (!unfinished) return undefined

    if (
      this.mutation.staleRestoreOnce &&
      !this.staleRestoreConsumed &&
      this.staleCheckpoint
    ) {
      this.staleRestoreConsumed = true
      return clone(this.staleCheckpoint)
    }

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
    const introduced = this.wordRecords
      .filter(isAcquisitionIntroductionRecord)
      .map((record) => record.word)

    const candidatePlan = planLearnAcquisitionCandidates({
      words,
      states: this.wordStates,
      pendingStates: pending,
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
      generateDueReview: this.generateDueReview,
      getWordRecords: async () => clone(this.wordRecords),
      getWordStates: async () => clone(this.wordStates),
      generateAcquisition: this.generateAcquisition,
      getNextSpacingResumeAt: async () => {
        const resumeTimes = [
          ...this.latestPendingAcquisitionStates().values(),
        ]
          .filter(
            (state) =>
              state.phase === 'deferred' &&
              state.deferredReason === 'spacing',
          )
          .map((state) => state.resumeAfter)
          .filter(
            (value): value is number => value !== undefined,
          )
        return resumeTimes.length > 0
          ? Math.min(...resumeTimes)
          : undefined
      },
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

  completeCurrentAcquisitionClean(): boolean {
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
      wrongCount: 0,
      classificationCause: 'clean',
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

    if (resolution.shouldPersistAdmission) {
      this.wordRecords.push(
        makeAcquisitionRecord({
          id: this.nextWordRecordId++,
          word: currentWord.name,
          now: this.now,
          policyVersion:
            LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
          spacingEligible: true,
        }),
      )
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
      success: true,
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

