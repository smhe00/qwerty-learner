import {
  LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
  LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
} from '../../src/learn/acquisition'
import {
  decideDailyAcquisitionQuota,
  learnAcquisitionQuotaPolicy,
  type LearnAcquisitionQuotaPolicy,
} from '../../src/learn/quota'
import { buildLearnStatsSnapshot } from '../../src/learn/stats'
import { countLongTermMasteredWords } from '../../src/learn/mastery'
import {
  defaultBasicReviewSchedulePolicy,
  scheduleBasicReview,
  type BasicReviewSchedulePolicy,
} from '../../src/review/scheduler'
import {
  createInitialReviewWordState,
  type IReviewWordState,
  type ReviewOutcome,
} from '../../src/review/types'
import type { IWordRecord } from '../../src/utils/db/record'

const DAY_SECONDS = 86_400

export type LearnerPersona = {
  id: string
  initialStrength: number
  wordDifficultySpread: number
  forgettingPerDay: number
  learningGain: number
  relearningGain: number
  lapsePenalty: number
  attentionNoise: number
  typingErrorRate: number
  hintDependence: number
  fatiguePerInteraction: number
  baseLatencyMs: number
}

export const LEARNER_PERSONAS: Record<string, LearnerPersona> = {
  strong: {
    id: 'strong-memory',
    initialStrength: 0.72,
    wordDifficultySpread: 0.18,
    forgettingPerDay: 0.018,
    learningGain: 0.2,
    relearningGain: 0.16,
    lapsePenalty: 0.08,
    attentionNoise: 0.05,
    typingErrorRate: 0.015,
    hintDependence: 0.06,
    fatiguePerInteraction: 0.0012,
    baseLatencyMs: 520,
  },
  balanced: {
    id: 'balanced',
    initialStrength: 0.6,
    wordDifficultySpread: 0.24,
    forgettingPerDay: 0.027,
    learningGain: 0.16,
    relearningGain: 0.13,
    lapsePenalty: 0.11,
    attentionNoise: 0.09,
    typingErrorRate: 0.03,
    hintDependence: 0.12,
    fatiguePerInteraction: 0.002,
    baseLatencyMs: 720,
  },
  weakMemory: {
    id: 'weak-memory',
    initialStrength: 0.48,
    wordDifficultySpread: 0.28,
    forgettingPerDay: 0.042,
    learningGain: 0.13,
    relearningGain: 0.12,
    lapsePenalty: 0.16,
    attentionNoise: 0.12,
    typingErrorRate: 0.04,
    hintDependence: 0.2,
    fatiguePerInteraction: 0.0025,
    baseLatencyMs: 900,
  },
  highFatigue: {
    id: 'high-fatigue',
    initialStrength: 0.58,
    wordDifficultySpread: 0.24,
    forgettingPerDay: 0.029,
    learningGain: 0.15,
    relearningGain: 0.12,
    lapsePenalty: 0.12,
    attentionNoise: 0.14,
    typingErrorRate: 0.045,
    hintDependence: 0.16,
    fatiguePerInteraction: 0.006,
    baseLatencyMs: 820,
  },
}

export class VirtualClock {
  constructor(public now: number) {}

  advanceSeconds(seconds: number) {
    this.now += seconds
  }

  advanceDays(days: number) {
    this.advanceSeconds(days * DAY_SECONDS)
  }
}

type LatentWordState = {
  difficulty: number
  strength: number
  lastPracticeAt: number
  admitted: boolean
  pending: boolean
}

export type SimulationDay = {
  day: number
  now: number
  introduced: number
  admitted: number
  reviews: number
  reviewSuccesses: number
  lapses: number
  dueBacklogEnd: number
  interactions: number
}

export type LearnerSimulationResult = {
  persona: LearnerPersona
  seed: number
  days: number
  dictionarySize: number
  wordRecords: IWordRecord[]
  wordStates: IReviewWordState[]
  daily: SimulationDay[]
  metrics: {
    introducedWords: number
    admittedWords: number
    masteredWords: number
    masteryRate: number
    reviewAttempts: number
    reviewSuccessRate: number
    lapseRate: number
    maxDueBacklog: number
    meanDailyInteractions: number
    p95DailyInteractions: number
    retentionAfter30d: number | null
  }
}

function createRng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value))
}

function logistic(value: number) {
  return 1 / (1 + Math.exp(-value))
}

function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(q * sorted.length) - 1),
  )
  return sorted[index]
}

function makeReviewEvidence(
  outcome: ReviewOutcome,
  independent: boolean,
) {
  return {
    version: 1 as const,
    memoryGrade: outcome,
    errorCause:
      outcome === 'again'
        ? ('recall' as const)
        : outcome === 'hard'
          ? ('spelling' as const)
          : ('clean' as const),
    confidence: independent ? 0.9 : 0.55,
    evidenceStrength: independent ? 1 : 0.6,
    retrievalValidity: independent
      ? ('independent' as const)
      : ('assisted' as const),
    reasonCodes: ['simulation'],
  }
}

function makeTelemetry(input: {
  latencyMs: number
  durationMs: number
  wrong: boolean
}) {
  return {
    telemetryVersion: 2 as const,
    firstKeyLatencyMs: input.latencyMs,
    attempts: [
      ...(input.wrong
        ? [
            {
              startLatencyMs: input.latencyMs,
              durationMs: Math.max(180, input.durationMs * 0.45),
              correctPrefixLength: 0,
              result: 'wrong' as const,
              wrongIndex: 0,
              wrongKey: 'x',
            },
          ]
        : []),
      {
        startLatencyMs: input.wrong ? 120 : input.latencyMs,
        durationMs: input.durationMs,
        correctPrefixLength: input.wrong ? 0 : 8,
        result: 'clean' as const,
      },
    ],
  }
}

function buildRecord(input: {
  id: number
  word: string
  now: number
  kind: 'acquisition' | 'review'
  outcome: ReviewOutcome
  independent: boolean
  hinted: boolean
  policyVersion?: string
  reasonCodes?: string[]
  latencyMs: number
  durationMs: number
}): IWordRecord {
  const wrongCount = input.outcome === 'again' ? 1 : 0
  return {
    id: input.id,
    word: input.word,
    timeStamp: input.now,
    dict: 'simulation',
    chapter: -1,
    timing: [input.durationMs],
    wrongCount,
    mistakes: wrongCount > 0 ? { 0: ['x'] } : {},
    sourceMode: 'learn',
    learnItemKind: input.kind,
    typingTelemetry: makeTelemetry({
      latencyMs: input.latencyMs,
      durationMs: input.durationMs,
      wrong: wrongCount > 0,
    }),
    learningContext: {
      version: 1,
      answerVisibilityAtStart: input.independent ? 'hidden' : 'partial',
      meaningVisibleAtStart: true,
      phoneticVisibleAtStart: !input.independent,
      exampleVisibleAtStart: false,
      pronunciationEnabledAtStart: true,
      pronunciationPlayed: true,
      pronunciationPlayedBeforeFirstKey: true,
      pronunciationAutomaticPlayCount: 1,
      ...(input.hinted
        ? {
            reviewHint: {
              version: 1 as const,
              maxLevel: 1 as const,
              coldProbeSurrendered: false,
              advanceCount: 1 as const,
            },
          }
        : {}),
    },
    reviewPolicyDecision: input.policyVersion
      ? {
          version: 1,
          policyVersion: input.policyVersion,
          reasonCodes: input.reasonCodes ?? [],
          conditionVersion: 1,
        }
      : undefined,
    reviewEvidence: makeReviewEvidence(
      input.outcome,
      input.independent,
    ),
    reviewRatingDecision:
      input.kind === 'review'
        ? {
            eligible: true,
            rating: input.outcome,
            confidence: 0.9,
            reasonCodes: ['simulation'],
          }
        : {
            eligible: false,
            rating: null,
            reason: 'training-event',
            reasonCodes: ['simulation-acquisition'],
          },
  }
}

function recallProbability(input: {
  latent: LatentWordState
  persona: LearnerPersona
  now: number
  fatigue: number
  random: () => number
}): number {
  const elapsedDays = Math.max(
    0,
    (input.now - input.latent.lastPracticeAt) / DAY_SECONDS,
  )
  const retainedStrength =
    input.latent.strength -
    input.persona.forgettingPerDay *
      Math.log2(1 + elapsedDays)
  const attention =
    (input.random() - 0.5) * 2 * input.persona.attentionNoise
  return clamp01(
    logistic(
      5.2 *
        (
          retainedStrength -
          input.latent.difficulty -
          input.fatigue +
          attention
        ),
    ),
  )
}

function chooseOutcome(
  probability: number,
  random: () => number,
): ReviewOutcome {
  const success = random() < probability
  if (!success) return 'again'
  if (probability >= 0.88 && random() > 0.25) return 'easy'
  if (probability < 0.62) return 'hard'
  return 'good'
}

export function simulateLearner(input: {
  persona: LearnerPersona
  seed: number
  days?: number
  dictionarySize?: number
  startAt?: number
  maxDailyReviews?: number
  schedulePolicy?: BasicReviewSchedulePolicy
  quotaPolicy?: LearnAcquisitionQuotaPolicy
}): LearnerSimulationResult {
  const days = input.days ?? 120
  const dictionarySize = input.dictionarySize ?? 240
  const maxDailyReviews = input.maxDailyReviews ?? 80
  const startAt =
    input.startAt ??
    Math.floor(new Date(2026, 0, 1, 8, 0, 0).getTime() / 1000)
  const clock = new VirtualClock(startAt)
  const random = createRng(input.seed)
  const words = Array.from(
    { length: dictionarySize },
    (_, index) => `word-${String(index).padStart(3, '0')}`,
  )
  const latent = new Map<string, LatentWordState>()
  for (const word of words) {
    latent.set(word, {
      difficulty: clamp01(
        0.42 +
          (random() - 0.5) * 2 * input.persona.wordDifficultySpread,
      ),
      strength: clamp01(
        input.persona.initialStrength +
          (random() - 0.5) * 0.08,
      ),
      lastPracticeAt: startAt,
      admitted: false,
      pending: false,
    })
  }

  const wordRecords: IWordRecord[] = []
  let wordStates: IReviewWordState[] = []
  const daily: SimulationDay[] = []
  let nextId = 1
  const thirtyDayEligible: Array<{ success: boolean }> = []

  for (let day = 0; day < days; day += 1) {
    let interactions = 0
    let reviews = 0
    let reviewSuccesses = 0
    let lapses = 0
    let introduced = 0
    let admitted = 0

    const due = wordStates
      .filter((state) => state.nextReviewAt <= clock.now)
      .sort((a, b) => a.nextReviewAt - b.nextReviewAt)
      .slice(0, maxDailyReviews)

    for (const state of due) {
      const item = latent.get(state.word)!
      const fatigue =
        input.persona.fatiguePerInteraction * interactions
      const probability = recallProbability({
        latent: item,
        persona: input.persona,
        now: clock.now,
        fatigue,
        random,
      })
      const outcome = chooseOutcome(probability, random)
      const typingSlip = random() < input.persona.typingErrorRate
      const finalOutcome =
        outcome !== 'again' && typingSlip ? 'hard' : outcome
      const hinted =
        finalOutcome === 'again' &&
        random() < input.persona.hintDependence
      const latencyMs = Math.round(
        input.persona.baseLatencyMs *
          (1 + fatigue * 2 + (1 - probability) * 0.8),
      )
      const durationMs = Math.round(420 + 700 * (1 - probability))
      const record = buildRecord({
        id: nextId++,
        word: state.word,
        now: clock.now,
        kind: 'review',
        outcome: finalOutcome,
        independent: !hinted,
        hinted,
        latencyMs,
        durationMs,
      })
      wordRecords.push(record)
      interactions += 1
      reviews += 1
      if (finalOutcome === 'again') {
        lapses += 1
        item.strength = clamp01(
          item.strength - input.persona.lapsePenalty,
        )
        item.strength +=
          input.persona.relearningGain * (1 - item.strength)
      } else {
        reviewSuccesses += 1
        item.strength +=
          input.persona.learningGain *
          (finalOutcome === 'easy' ? 1.18 : 1) *
          (1 - item.strength)
      }
      item.lastPracticeAt = clock.now

      const elapsedSinceCreation =
        (clock.now - state.createdAt) / DAY_SECONDS
      if (elapsedSinceCreation >= 30) {
        thirtyDayEligible.push({
          success: finalOutcome !== 'again',
        })
      }

      const next = scheduleBasicReview(
        {
          state,
          outcome: finalOutcome,
          now: clock.now,
        },
        input.schedulePolicy ?? defaultBasicReviewSchedulePolicy,
      )
      wordStates = wordStates.map((existing) =>
        existing.word === state.word ? next : existing,
      )
      clock.advanceSeconds(2)
    }

    const statsBefore = buildLearnStatsSnapshot({
      now: clock.now,
      dict: 'simulation',
      wordRecords,
      wordStates,
      dictionaryWords: words,
    })
    const quota = decideDailyAcquisitionQuota(
      statsBefore,
      input.quotaPolicy ?? learnAcquisitionQuotaPolicy,
    )

    const pending = words.filter(
      (word) => latent.get(word)?.pending,
    )
    const unseen = words.filter((word) => {
      const item = latent.get(word)!
      return !item.admitted && !item.pending &&
        !wordRecords.some(
          (record) =>
            record.word === word &&
            record.learnItemKind === 'acquisition',
        )
    })

    const acquisitionCandidates =
      statsBefore.lifecycle.due > 0
        ? []
        : [
            ...pending,
            ...unseen.slice(0, quota.allowedNow),
          ]

    for (const word of acquisitionCandidates) {
      if (interactions >= maxDailyReviews + 40) break
      const item = latent.get(word)!
      const isFresh = !item.pending

      if (isFresh) {
        introduced += 1
        wordRecords.push(
          buildRecord({
            id: nextId++,
            word,
            now: clock.now,
            kind: 'acquisition',
            outcome: 'good',
            independent: false,
            hinted: false,
            policyVersion:
              LEARN_ACQUISITION_EXPOSURE_POLICY_VERSION,
            reasonCodes: [
              'learn-acquisition-exposure',
              'visible-copy',
              'scheduler-neutral',
            ],
            latencyMs: Math.round(input.persona.baseLatencyMs * 0.6),
            durationMs: 520,
          }),
        )
        interactions += 1
        item.strength +=
          input.persona.learningGain * 0.7 * (1 - item.strength)
        item.lastPracticeAt = clock.now
        item.pending = true
        clock.advanceSeconds(300)
      }

      const fatigue =
        input.persona.fatiguePerInteraction * interactions
      const probability = recallProbability({
        latent: item,
        persona: input.persona,
        now: clock.now,
        fatigue,
        random,
      })
      const passed = random() < probability
      wordRecords.push(
        buildRecord({
          id: nextId++,
          word,
          now: clock.now,
          kind: 'acquisition',
          outcome: passed ? 'good' : 'again',
          independent: true,
          hinted: false,
          policyVersion:
            LEARN_ACQUISITION_INDEPENDENT_POLICY_VERSION,
          reasonCodes: [
            'learn-acquisition-independent',
            'delayed-recall',
            'scheduler-neutral',
            'spacing-eligible',
          ],
          latencyMs: Math.round(
            input.persona.baseLatencyMs *
              (1 + (1 - probability)),
          ),
          durationMs: 650,
        }),
      )
      interactions += 1
      item.lastPracticeAt = clock.now

      if (passed) {
        admitted += 1
        item.pending = false
        item.admitted = true
        item.strength +=
          input.persona.learningGain * (1 - item.strength)
        const state = createInitialReviewWordState(
          'simulation',
          word,
          clock.now,
        )
        state.nextReviewAt = clock.now + DAY_SECONDS
        wordStates.push(state)
      } else {
        item.strength = clamp01(
          item.strength -
            input.persona.lapsePenalty * 0.5 +
            input.persona.relearningGain * 0.8,
        )
      }
      clock.advanceSeconds(2)
    }

    const dueBacklogEnd = wordStates.filter(
      (state) => state.nextReviewAt <= clock.now,
    ).length

    daily.push({
      day,
      now: clock.now,
      introduced,
      admitted,
      reviews,
      reviewSuccesses,
      lapses,
      dueBacklogEnd,
      interactions,
    })

    const nextDay = startAt + (day + 1) * DAY_SECONDS
    clock.now = Math.max(clock.now, nextDay)
  }

  const introducedWords = new Set(
    wordRecords
      .filter((record) => record.learnItemKind === 'acquisition')
      .map((record) => record.word),
  ).size
  const admittedWords = wordStates.length
  const masteredWords = countLongTermMasteredWords(wordStates)
  const reviewAttempts = daily.reduce(
    (sum, item) => sum + item.reviews,
    0,
  )
  const reviewSuccesses = daily.reduce(
    (sum, item) => sum + item.reviewSuccesses,
    0,
  )
  const lapses = daily.reduce(
    (sum, item) => sum + item.lapses,
    0,
  )
  const interactions = daily.map((item) => item.interactions)
  const retentionAfter30d =
    thirtyDayEligible.length === 0
      ? null
      : thirtyDayEligible.filter((item) => item.success).length /
        thirtyDayEligible.length

  return {
    persona: input.persona,
    seed: input.seed,
    days,
    dictionarySize,
    wordRecords,
    wordStates,
    daily,
    metrics: {
      introducedWords,
      admittedWords,
      masteredWords,
      masteryRate:
        admittedWords === 0 ? 0 : masteredWords / admittedWords,
      reviewAttempts,
      reviewSuccessRate:
        reviewAttempts === 0 ? 0 : reviewSuccesses / reviewAttempts,
      lapseRate:
        reviewAttempts === 0 ? 0 : lapses / reviewAttempts,
      maxDueBacklog: Math.max(
        0,
        ...daily.map((item) => item.dueBacklogEnd),
      ),
      meanDailyInteractions:
        interactions.reduce((sum, value) => sum + value, 0) /
        interactions.length,
      p95DailyInteractions: quantile(interactions, 0.95),
      retentionAfter30d,
    },
  }
}
