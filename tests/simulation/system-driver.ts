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
import { buildLearnStatsSnapshot } from '../../src/learn/stats'
import {
  buildLearnAcquisitionStates,
  canonicalizeLearningWords,
  planLearnAcquisitionCandidates,
  resolveLearnItemKindForWord,
  selectLearnMixedSessionItems,
} from '../../src/learn/session'
import { selectReviewCandidates } from '../../src/review/due'
import { rankDueReviewCandidates } from '../../src/review/priority'
import type { LearnLifecycleSeedAction } from '../../src/learn/trace-ir'
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
  silentNoopAtInteraction?: number
  pendingAsFresh?: boolean
  admittedInAcquisition?: boolean
  excludedSelected?: boolean
  duplicateCanonical?: boolean
  finishedShadowsUnfinished?: boolean
  oldestUnfinishedRestore?: boolean
  wrongDictRestore?: boolean
  waitingDespiteUnfinished?: boolean
  freshOverBudget?: boolean
  pendingConsumesFreshBudget?: boolean
  quotaIgnoresUnseen?: boolean
  routeResurrectsFinished?: boolean
  postFinishEvidence?: boolean
  wrongMixedOwnership?: boolean
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
  private routeResurrectionConsumed = false
  private postFinishEvidenceInjected = false

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

  seedExcludedWord(wordIndex = 0) {
    const target = this.words[wordIndex]
    if (!target) {
      throw new Error('excluded seed word index out of range')
    }
    if (
      this.wordStates.some(
        (state) => state.word === target.name,
      )
    ) {
      return
    }

    this.wordRecords.push(
      makeAcquisitionRecord({
        id: this.nextWordRecordId++,
        word: target.name,
        now: this.now - 1,
        policyVersion:
          LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
        spacingEligible: true,
      }),
    )
    const state = createInitialReviewWordState(
      'simulation',
      target.name,
      this.now - 1,
    )
    state.lifecycle = 'excluded'
    state.nextReviewAt = this.now
    state.exclusion = {
      reason: 'manual',
      excludedAt: this.now,
    }
    this.wordStates.push(state)
  }

  seedHistoricalSession(input: {
    dict?: string
    createTime: number
    finished: boolean
    sessionKind?: 'review' | 'acquisition'
    wordName?: string
  }): number {
    const id = this.nextSessionId++
    const wordName =
      input.wordName ?? `f7-session-${id}`
    const session: ReviewRecord = {
      id,
      dict: input.dict ?? 'simulation',
      index: 0,
      createTime: input.createTime,
      isFinished: input.finished,
      words: [
        {
          name: wordName,
          trans: [],
          usphone: '',
          ukphone: '',
        },
      ],
      sessionKind: input.sessionKind ?? 'review',
    } as ReviewRecord
    this.sessions.push(clone(session))
    return id
  }

  private sessionById(id: number | undefined) {
    if (id === undefined) return undefined
    return this.sessions.find((session) => session.id === id)
  }

  private recoverableSessions(dictId: string) {
    return this.sessions
      .filter(
        (session) =>
          session.dict === dictId &&
          !session.isFinished,
      )
      .sort((a, b) => a.createTime - b.createTime)
  }

  private latestUnfinishedSession(
    dictId: string,
  ): StoredSession | undefined {
    if (
      this.mutation.routeResurrectsFinished &&
      !this.routeResurrectionConsumed
    ) {
      const finished = this.sessions
        .filter(
          (session) =>
            session.dict === dictId &&
            session.isFinished,
        )
        .sort((a, b) => a.createTime - b.createTime)
        .at(-1)
      if (finished) {
        this.routeResurrectionConsumed = true
        const resurrected = {
          ...clone(finished),
          isFinished: false,
        } as StoredSession
        const index = this.sessions.findIndex(
          (session) => session.id === resurrected.id,
        )
        if (index >= 0) {
          this.sessions[index] = clone(resurrected)
        }
        return resurrected
      }
    }

    if (
      this.mutation.staleRestoreOnce &&
      !this.staleRestoreConsumed &&
      this.staleCheckpoint
    ) {
      this.staleRestoreConsumed = true
      return clone(this.staleCheckpoint)
    }

    const expected = this.recoverableSessions(dictId)
    if (expected.length === 0) return undefined

    if (this.mutation.waitingDespiteUnfinished) {
      return undefined
    }

    if (this.mutation.finishedShadowsUnfinished) {
      const latestUnfinished = expected.at(-1)
      const shadowed =
        latestUnfinished !== undefined &&
        this.sessions.some(
          (session) =>
            session.dict === dictId &&
            session.isFinished &&
            session.createTime >
              latestUnfinished.createTime,
        )
      if (shadowed) return undefined
    }

    if (this.mutation.wrongDictRestore) {
      const wrong = this.sessions
        .filter(
          (session) =>
            session.dict !== dictId &&
            !session.isFinished,
        )
        .sort((a, b) => a.createTime - b.createTime)
        .at(-1)
      if (wrong) return clone(wrong)
    }

    const selected =
      this.mutation.oldestUnfinishedRestore
        ? expected[0]
        : expected.at(-1)
    return selected ? clone(selected) : undefined
  }

  private latestPendingAcquisitionStates() {
    const latest = new Map<string, LearnAcquisitionState>()

    for (const session of [...this.sessions].sort(
      (a, b) => a.createTime - b.createTime,
    )) {
      if (
        session.sessionKind !== 'acquisition' &&
        session.sessionKind !== 'mixed'
      ) {
        continue
      }
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

  private lifecycleForCandidate(input: {
    word: string
    pendingStates: Map<string, LearnAcquisitionState>
    introducedWords: Set<string>
  }):
    | 'unseen'
    | 'introduced'
    | 'pending'
    | 'admitted'
    | 'excluded' {
    const persistent = this.wordStates.find(
      (state) => state.word === input.word,
    )
    if (persistent?.lifecycle === 'excluded') {
      return 'excluded'
    }
    if (persistent) return 'admitted'
    if (input.pendingStates.has(input.word)) return 'pending'
    if (input.introducedWords.has(input.word)) {
      return 'introduced'
    }
    return 'unseen'
  }

  private emitCandidateSelections(input: {
    selected: Word[]
    candidateKindByWord: Map<
      string,
      'fresh' | 'pending' | 'due' | 'force'
    >
    pendingStates?: Map<string, LearnAcquisitionState>
    introducedWords?: Iterable<string>
  }) {
    const pendingStates =
      input.pendingStates ?? new Map<string, LearnAcquisitionState>()
    const introducedWords = new Set(
      input.introducedWords ?? [],
    )
    const counts = new Map<string, number>()
    for (const word of input.selected) {
      counts.set(word.name, (counts.get(word.name) ?? 0) + 1)
    }

    for (const [word, selectedCount] of counts) {
      const persistent = this.wordStates.find(
        (state) => state.word === word,
      )
      this.events.push({
        kind: 'candidate-selection',
        candidateKind:
          input.candidateKindByWord.get(word) ?? 'fresh',
        word,
        lifecycle: this.lifecycleForCandidate({
          word,
          pendingStates,
          introducedWords,
        }),
        due:
          persistent !== undefined &&
          persistent.lifecycle !== 'excluded' &&
          persistent.nextReviewAt <= this.now,
        selectedCount,
      })
    }
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
    let resumed = [...candidatePlan.resumed]
    let freshWords = [...candidatePlan.freshWords]
    const canonicalWords =
      canonicalizeLearningWords(words)
    const canonicalByName = new Map(
      canonicalWords.map((word) => [
        word.name,
        word,
      ]),
    )
    const budgetStats = buildLearnStatsSnapshot({
      now: this.now,
      dict: 'simulation',
      wordRecords: this.wordRecords,
      wordStates: this.wordStates,
      dictionaryWords: canonicalWords.map(
        (word) => word.name,
      ),
    })
    const productionQuota =
      decideDailyAcquisitionQuota(budgetStats)

    if (this.mutation.pendingAsFresh) {
      const pendingWord = [...pending.keys()][0]
      const candidate = pendingWord
        ? canonicalByName.get(pendingWord)
        : undefined
      if (candidate) {
        resumed = resumed.filter(
          (item) => item.word.name !== candidate.name,
        )
        freshWords = [
          candidate,
          ...freshWords.filter(
            (word) => word.name !== candidate.name,
          ),
        ]
      }
    }

    if (this.mutation.admittedInAcquisition) {
      const admittedWord = this.wordStates.find(
        (state) => state.lifecycle !== 'excluded',
      )?.word
      const candidate = admittedWord
        ? canonicalByName.get(admittedWord)
        : undefined
      if (
        candidate &&
        !freshWords.some(
          (word) => word.name === candidate.name,
        )
      ) {
        freshWords = [candidate, ...freshWords]
      }
    }

    if (this.mutation.pendingConsumesFreshBudget) {
      resumed = resumed.slice(0, freshLimit)
    }

    if (this.mutation.freshOverBudget) {
      const persistent = new Set(
        this.wordStates.map((state) => state.word),
      )
      const pendingNames = new Set(pending.keys())
      const introducedNames = new Set(introduced)
      const selectedFresh = new Set(
        freshWords.map((word) => word.name),
      )
      const extra = canonicalWords.find(
        (word) =>
          !persistent.has(word.name) &&
          !pendingNames.has(word.name) &&
          !introducedNames.has(word.name) &&
          !selectedFresh.has(word.name),
      )
      if (extra) freshWords = [...freshWords, extra]
    }

    let selected = [
      ...resumed.map((item) => item.word),
      ...freshWords,
    ]
    if (
      this.mutation.duplicateCanonical &&
      selected.length > 0
    ) {
      selected = [selected[0], ...selected]
    }
    const productionReadyPendingCount =
      candidatePlan.resumed.length
    this.events.push({
      kind: 'fresh-budget',
      targetDailyNewWords:
        productionQuota.targetDailyNewWords,
      introducedToday:
        budgetStats.today.introducedWords,
      acquiredToday:
        budgetStats.today.acquiredWords,
      unseenCount: budgetStats.lifecycle.unseen,
      dueCount: budgetStats.lifecycle.due,
      allowedNow: freshLimit,
      freshSelected: freshWords.length,
      readyPendingCount:
        productionReadyPendingCount,
      pendingSelected: resumed.length,
    })

    if (selected.length === 0) return undefined

    const candidateKindByWord = new Map<
      string,
      'fresh' | 'pending'
    >()
    for (const item of resumed) {
      candidateKindByWord.set(item.word.name, 'pending')
    }
    for (const word of freshWords) {
      candidateKindByWord.set(word.name, 'fresh')
    }
    this.emitCandidateSelections({
      selected,
      candidateKindByWord,
      pendingStates: pending,
      introducedWords: introduced,
    })

    const freshStates = buildLearnAcquisitionStates(
      freshWords,
    )
    const acquisitionStates = {
      ...freshStates,
      ...Object.fromEntries(
        resumed.map(({ word, state }) => [
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
      canonicalizeLearningWords(words).map((word) => ({
        word: word.name,
        originData: word,
      })),
      this.wordStates,
      this.now,
      'due',
    ).map((item) => item.originData)

    if (selected.length === 0) return undefined

    this.emitCandidateSelections({
      selected,
      candidateKindByWord: new Map(
        selected.map((word) => [word.name, 'due' as const]),
      ),
    })

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


  private generateUnifiedSession = async (
    _dictId: string,
    words: Word[],
    _errorEvidence: never[],
    freshLimit: number,
  ): Promise<ReviewRecord | undefined> => {
    const canonicalWords = canonicalizeLearningWords(words)
    const canonicalByName = new Map(
      canonicalWords.map((word) => [word.name, word]),
    )
    const reviewCandidates = canonicalWords.map((originData) => ({
      word: originData.name,
      originData,
    }))
    const dueWords = this.mutation.bypassDueFirst
      ? []
      : rankDueReviewCandidates(
          selectReviewCandidates(
            reviewCandidates,
            this.wordStates,
            this.now,
            'due',
          ),
          this.wordStates,
        ).map((item) => item.originData)

    const pending = this.latestPendingAcquisitionStates()
    const plannerPending =
      this.mutation.strandReadyDeferred
        ? new Map(
            [...pending].filter(([, state]) => {
              const ready =
                state.phase === 'deferred' &&
                state.resumeAfter !== undefined &&
                state.resumeAfter <= this.now
              return !ready
            }),
          )
        : pending
    const introduced = this.wordRecords
      .filter(isAcquisitionIntroductionRecord)
      .map((record) => record.word)

    const candidatePlan = planLearnAcquisitionCandidates({
      words: canonicalWords,
      states: this.wordStates,
      pendingStates: plannerPending,
      introducedWords: introduced,
      freshLimit,
      now: this.now,
    })
    let resumed = [...candidatePlan.resumed]
    let freshWords = [...candidatePlan.freshWords]

    if (this.mutation.pendingAsFresh) {
      const pendingWord = [...pending.keys()][0]
      const candidate = pendingWord
        ? canonicalByName.get(pendingWord)
        : undefined
      if (candidate) {
        resumed = resumed.filter(
          (item) => item.word.name !== candidate.name,
        )
        freshWords = [
          candidate,
          ...freshWords.filter(
            (word) => word.name !== candidate.name,
          ),
        ]
      }
    }

    if (this.mutation.admittedInAcquisition) {
      const admittedWord = this.wordStates.find(
        (state) => state.lifecycle !== 'excluded',
      )?.word
      const candidate = admittedWord
        ? canonicalByName.get(admittedWord)
        : undefined
      if (
        candidate &&
        !freshWords.some(
          (word) => word.name === candidate.name,
        )
      ) {
        freshWords = [candidate, ...freshWords]
      }
    }

    if (this.mutation.pendingConsumesFreshBudget) {
      resumed = resumed.slice(0, freshLimit)
    }

    if (this.mutation.freshOverBudget) {
      const persistent = new Set(
        this.wordStates.map((state) => state.word),
      )
      const pendingNames = new Set(pending.keys())
      const introducedNames = new Set(introduced)
      const selectedFresh = new Set(
        freshWords.map((word) => word.name),
      )
      const extra = canonicalWords.find(
        (word) =>
          !persistent.has(word.name) &&
          !pendingNames.has(word.name) &&
          !introducedNames.has(word.name) &&
          !selectedFresh.has(word.name),
      )
      if (extra) freshWords = [...freshWords, extra]
    }

    const acquisitionCandidates = [
      ...resumed.map(({ word, state }) => ({
        word,
        state,
        resumed: true as const,
      })),
      ...freshWords.map((word) => ({
        word,
        state: undefined,
        resumed: false as const,
      })),
    ]
    const selection = selectLearnMixedSessionItems({
      dueWords,
      acquisitionWords: acquisitionCandidates.map(
        (item) => item.word,
      ),
    })
    const selectedAcquisition = acquisitionCandidates.slice(
      0,
      selection.selectedAcquisitionWords.length,
    )
    const selectedFresh = selectedAcquisition
      .filter((item) => !item.resumed)
      .map((item) => item.word)
    const selectedPending = selectedAcquisition.filter(
      (item) => item.resumed,
    )

    const budgetStats = buildLearnStatsSnapshot({
      now: this.now,
      dict: 'simulation',
      wordRecords: this.wordRecords,
      wordStates: this.wordStates,
      dictionaryWords: canonicalWords.map(
        (word) => word.name,
      ),
    })
    const productionQuota =
      decideDailyAcquisitionQuota(budgetStats)
    this.events.push({
      kind: 'fresh-budget',
      targetDailyNewWords:
        productionQuota.targetDailyNewWords,
      introducedToday:
        budgetStats.today.introducedWords,
      acquiredToday:
        budgetStats.today.acquiredWords,
      unseenCount: budgetStats.lifecycle.unseen,
      dueCount: budgetStats.lifecycle.due,
      allowedNow: freshLimit,
      freshSelected: selectedFresh.length,
      readyPendingCount: candidatePlan.resumed.length,
      pendingSelected: selectedPending.length,
    })

    if (selection.selectedWords.length === 0) {
      return undefined
    }

    let sessionWords = [...selection.selectedWords]
    if (
      this.mutation.duplicateCanonical &&
      sessionWords.length > 0
    ) {
      sessionWords = [sessionWords[0], ...sessionWords]
    }

    const candidateKindByWord = new Map<
      string,
      'fresh' | 'pending' | 'due'
    >()
    for (const word of selection.selectedReviewWords) {
      candidateKindByWord.set(word.name, 'due')
    }
    for (const item of selectedPending) {
      candidateKindByWord.set(item.word.name, 'pending')
    }
    for (const word of selectedFresh) {
      candidateKindByWord.set(word.name, 'fresh')
    }
    this.emitCandidateSelections({
      selected: sessionWords,
      candidateKindByWord,
      pendingStates: pending,
      introducedWords: introduced,
    })

    const acquisitionStates = {
      ...buildLearnAcquisitionStates(selectedFresh),
      ...Object.fromEntries(
        selectedPending.map(({ word, state }) => [
          word.name,
          state,
        ]),
      ),
    }
    const itemKinds = {
      ...selection.itemKinds,
    }
    if (
      this.mutation.wrongMixedOwnership &&
      selection.sessionKind === 'mixed'
    ) {
      const acquisitionWord =
        selection.selectedAcquisitionWords[0]
      if (acquisitionWord) {
        itemKinds[acquisitionWord.name] = 'review'
      }
    }

    const session: ReviewRecord = {
      id: this.nextSessionId++,
      dict: 'simulation',
      index: 0,
      createTime: this.now,
      isFinished: false,
      words: clone(sessionWords),
      sessionKind: selection.sessionKind,
      itemKinds,
      ...(selectedAcquisition.length > 0
        ? { acquisitionStates }
        : {}),
      recommendedGoal: {
        version: 1,
        kind: 'session-completion',
        targetUniqueWords: new Set(
          sessionWords.map((word) => word.name),
        ).size,
      },
    } as ReviewRecord

    this.sessions.push(clone(session))
    return clone(session)
  }

  private dependencies(): LearnPreparationDependencies<never> {
    return {
      now: () => this.now,
      bootstrap: async () => undefined,
      getLatestSession: async (dictId) =>
        this.latestUnfinishedSession(dictId),
      generateDueReview: this.mutation.bypassDueFirst
        ? async () => undefined
        : this.generateDueReview,
      getWordRecords: async () => clone(this.wordRecords),
      getWordStates: async () => clone(this.wordStates),
      generateAcquisition: this.generateAcquisition,
      generateSession: this.generateUnifiedSession,
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
      ...(this.mutation.quotaIgnoresUnseen
        ? {
            decideQuota: (stats) => {
              const baseline =
                decideDailyAcquisitionQuota(stats)
              const remaining = Math.max(
                0,
                baseline.targetDailyNewWords -
                  stats.today.introducedWords,
              )
              return {
                ...baseline,
                remainingDailyNewWords: remaining,
                allowedNow:
                  stats.lifecycle.due > 0 ? 0 : remaining,
              }
            },
          }
        : {}),
    }
  }

  selectForceReviewCandidates(): Word[] {
    const canonical = canonicalizeLearningWords(this.words)
    let selected = selectReviewCandidates(
      canonical.map((word) => ({
        word: word.name,
        originData: word,
      })),
      this.wordStates,
      this.now,
      'force',
    ).map((item) => item.originData)

    if (this.mutation.excludedSelected) {
      const excludedWord = this.wordStates.find(
        (state) => state.lifecycle === 'excluded',
      )?.word
      const candidate = excludedWord
        ? canonical.find(
            (word) => word.name === excludedWord,
          )
        : undefined
      if (
        candidate &&
        !selected.some(
          (word) => word.name === candidate.name,
        )
      ) {
        selected = [candidate, ...selected]
      }
    }

    this.emitCandidateSelections({
      selected,
      candidateKindByWord: new Map(
        selected.map((word) => [
          word.name,
          'force' as const,
        ]),
      ),
    })
    return clone(selected)
  }

  async enter(): Promise<LearnPreparationResult> {
    const activeDict = 'simulation'
    const recoverable =
      this.recoverableSessions(activeDict)
    const expected = recoverable.at(-1)

    const result = await prepareLearnSession({
      dictId: activeDict,
      words: this.words,
      errorEvidence: [],
      dependencies: this.dependencies(),
    })

    const decision =
      result.kind === 'waiting'
        ? ('waiting' as const)
        : result.source === 'restored'
          ? ('restore' as const)
          : result.source === 'review'
            ? ('new-review' as const)
            : ('new-acquisition' as const)
    const selected =
      result.kind === 'session' &&
      result.source === 'restored'
        ? result.record
        : undefined

    this.events.push({
      kind: 'session-arbitration',
      activeDict,
      recoverableCount: recoverable.length,
      expectedSessionId:
        expected?.id !== undefined
          ? `id:${expected.id}`
          : null,
      decision,
      selectedSessionId:
        selected?.id !== undefined
          ? `id:${selected.id}`
          : null,
      selectedDict: selected?.dict ?? null,
      selectedFinished:
        selected?.isFinished ?? null,
      selectedCount: selected ? 1 : 0,
    })
    this.events.push(preparationResultToTraceEvent(result))

    const pendingAfterPrepare =
      this.latestPendingAcquisitionStates()
    this.events.push({
      kind: 'acquisition-health',
      now: this.now,
      opportunity:
        result.kind === 'session'
          ? result.source === 'acquisition' ||
            result.source === 'mixed'
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

      this.events.push({
        kind: 'lifecycle',
        action: 'route-enter',
        sessionId:
          result.record.id !== undefined
            ? `id:${result.record.id}`
            : null,
        isFinished: result.record.isFinished,
      })

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
      this.events.push({
        kind: 'lifecycle',
        action: 'route-enter',
        sessionId: null,
        isFinished: null,
      })
    }

    return result
  }

  exit() {
    const session = this.sessionById(this.activeSessionId)
    this.events.push({
      kind: 'lifecycle',
      action: 'route-leave',
      sessionId:
        session?.id !== undefined
          ? `id:${session.id}`
          : null,
      isFinished: session?.isFinished ?? null,
    })
    this.activeSessionId = undefined
  }

  refresh() {
    const session = this.sessionById(this.activeSessionId)
    this.events.push({
      kind: 'lifecycle',
      action: 'reload',
      sessionId:
        session?.id !== undefined
          ? `id:${session.id}`
          : null,
      isFinished: session?.isFinished ?? null,
    })
    this.exit()
    return this.enter()
  }

  background() {
    const session = this.sessionById(this.activeSessionId)
    this.events.push({
      kind: 'lifecycle',
      action: 'background',
      sessionId:
        session?.id !== undefined
          ? `id:${session.id}`
          : null,
      isFinished: session?.isFinished ?? null,
    })
  }

  foreground() {
    const session = this.sessionById(this.activeSessionId)
    this.events.push({
      kind: 'lifecycle',
      action: 'foreground',
      sessionId:
        session?.id !== undefined
          ? `id:${session.id}`
          : null,
      isFinished: session?.isFinished ?? null,
    })
  }

  async applyLifecycleActions(
    actions: LearnLifecycleSeedAction[],
  ): Promise<void> {
    for (const action of actions) {
      if (action.kind === 'enter') {
        await this.enter()
      } else if (action.kind === 'route-leave') {
        this.exit()
      } else if (action.kind === 'reload') {
        await this.refresh()
      } else if (action.kind === 'background') {
        this.background()
      } else if (action.kind === 'foreground') {
        this.foreground()
      } else if (action.kind === 'retry-current') {
        this.completeCurrentClean()
      }
    }
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

  private currentItemKind(
    session: StoredSession,
  ): 'review' | 'acquisition' | undefined {
    const currentWord = session.words[session.index]
    if (!currentWord) return undefined
    return resolveLearnItemKindForWord(
      session,
      currentWord.name,
    )
  }

  private emitLearnEvidence(
    session: StoredSession,
    word: string,
    itemKind: 'review' | 'acquisition',
  ) {
    if (session.id === undefined) return
    this.events.push({
      kind: 'learn-evidence-durable',
      sessionId: `id:${session.id}`,
      word,
      itemKind,
    })
  }

  private maybeInjectPostFinishEvidence(
    session: StoredSession,
    word: Word,
    itemKind: 'review' | 'acquisition',
  ) {
    if (
      !this.mutation.postFinishEvidence ||
      this.postFinishEvidenceInjected ||
      !session.isFinished
    ) {
      return
    }

    this.postFinishEvidenceInjected = true
    if (itemKind === 'review') {
      this.wordRecords.push(
        makeReviewRecord({
          id: this.nextWordRecordId++,
          word: word.name,
          now: this.now,
          outcome: 'good',
          attemptRole: 'cold',
        }),
      )
    } else {
      this.wordRecords.push(
        makeAcquisitionRecord({
          id: this.nextWordRecordId++,
          word: word.name,
          now: this.now,
          policyVersion:
            LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
          spacingEligible: true,
        }),
      )
    }
    this.emitLearnEvidence(session, word.name, itemKind)
  }

  completeCurrentReview(
    outcome: VirtualReviewOutcome = 'good',
  ): boolean {
    const session = this.sessionById(this.activeSessionId)
    if (!session || session.isFinished) {
      return false
    }

    const currentWord = session.words[session.index]
    if (
      !currentWord ||
      this.currentItemKind(session) !== 'review'
    ) {
      return false
    }
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
    const silentNoop =
      this.mutation.silentNoopAtInteraction ===
      this.interactionCount
    const shouldDropProjection =
      silentNoop ||
      this.mutation.dropProjectionAtInteraction ===
        this.interactionCount

    if (!shouldDropProjection) {
      session.index = resolution.projection.index
      session.words = clone(resolution.projection.queue)
      session.isFinished = resolution.projection.isFinished
    }
    if (!silentNoop) {
      session.exercisePlans = clone(resolution.exercisePlans)
      session.reinforcementCounts = clone(
        resolution.reinforcementCounts,
      )
      session.itemStates = clone(resolution.itemStates)
    }

    this.wordRecords.push(
      makeReviewRecord({
        id: this.nextWordRecordId++,
        word: currentWord.name,
        now: this.now,
        outcome,
        attemptRole,
      }),
    )
    this.emitLearnEvidence(
      session,
      currentWord.name,
      'review',
    )

    const stateIndex = this.wordStates.findIndex(
      (state) => state.word === currentWord.name,
    )
    if (stateIndex >= 0 && isCold && !silentNoop) {
      this.wordStates[stateIndex] = scheduleBasicReview({
        state: this.wordStates[stateIndex],
        outcome,
        now: this.now,
      })
    }

    this.persistSession(session)
    this.maybeInjectPostFinishEvidence(
      session,
      currentWord,
      'review',
    )
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
    const itemKind = this.currentItemKind(session)
    return itemKind === 'review'
      ? this.completeCurrentReview('good')
      : itemKind === 'acquisition'
        ? this.completeCurrentAcquisitionClean()
        : false
  }

  completeCurrentAttempt(
    outcome: VirtualReviewOutcome,
  ): boolean {
    const session = this.sessionById(this.activeSessionId)
    if (!session) return false
    const itemKind = this.currentItemKind(session)
    if (itemKind === 'review') {
      return this.completeCurrentReview(outcome)
    }
    if (itemKind !== 'acquisition') return false

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
    if (!session || session.isFinished) {
      return false
    }

    const currentWord = session.words[session.index]
    if (
      !currentWord ||
      this.currentItemKind(session) !== 'acquisition'
    ) {
      return false
    }
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
      this.emitLearnEvidence(
        session,
        currentWord.name,
        'acquisition',
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
    const silentNoop =
      this.mutation.silentNoopAtInteraction ===
      this.interactionCount
    const shouldDropProjection =
      silentNoop ||
      this.mutation.dropProjectionAtInteraction ===
        this.interactionCount

    const expected = resolution.projection
    if (!shouldDropProjection) {
      session.index = expected.index
      session.words = clone(expected.queue)
      session.isFinished = expected.isFinished
    }
    if (!silentNoop) {
      session.acquisitionStates =
        clone(resolution.acquisitionStates)
    }

    if (currentState.phase === 'independent' && !silentNoop) {
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
      this.emitLearnEvidence(
        session,
        currentWord.name,
        'acquisition',
      )
    }

    if (resolution.shouldPersistAdmission && !silentNoop) {
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
      !silentNoop &&
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
    this.maybeInjectPostFinishEvidence(
      session,
      currentWord,
      'acquisition',
    )

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

  auditOccurrenceIdentity(word: string) {
    const session = this.sessionById(this.activeSessionId)
    if (!session || session.id === undefined) return undefined

    const event: LearnSystemTraceEvent = {
      kind: 'occurrence-identity',
      sessionId: `id:${session.id}`,
      word,
      occurrenceCount: session.words.filter(
        (item) => item.name === word,
      ).length,
      logicalStateEntries:
        Number(Boolean(session.itemStates?.[word])) +
        Number(Boolean(session.acquisitionStates?.[word])),
    }
    this.events.push(event)
    return event
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

