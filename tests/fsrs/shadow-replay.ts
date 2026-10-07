import {
  Rating,
  State,
  createEmptyCard,
  fsrs,
  type Card,
} from 'ts-fsrs'

export const FSRS_SHADOW_SCHEMA_VERSION = 1 as const
export const FSRS_SHADOW_LIBRARY_VERSION = '5.4.2' as const
export const FSRS_SHADOW_ALGORITHM_MODEL = 'fsrs-6' as const
export const FSRS_SHADOW_PARAMETER_SET_ID =
  'fsrs6-default-r0.84-no-fuzz-long-term-v1' as const

const DAY_MS = 24 * 60 * 60 * 1000

export type ShadowReviewOutcome = 'again' | 'hard' | 'good' | 'easy'

export type ShadowRatingDecision =
  | {
      eligible: false
      rating: null
      reason?: string
    }
  | {
      eligible: true
      rating: ShadowReviewOutcome
    }

export type FsrsReplayRecord = {
  id?: number
  dict: string
  word: string
  timeStamp: number
  sourceMode?: 'typing' | 'learn'
  learnItemKind?: 'review' | 'acquisition'
  reviewRatingDecision?: ShadowRatingDecision
}

export type FsrsReplayCurrentState = {
  dict: string
  word: string
  reviewCount: number
}

export type FsrsHistoryCoverage =
  | 'unknown'
  | 'review-count-matched'
  | 'partial-history'
  | 'event-count-exceeds-state'

export type FsrsShadowCardSnapshotV1 = {
  dueAt: number
  lastReviewAt: number | null
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  learningSteps: number
  state: number
}

export type FsrsCounterfactualV1 = {
  dueAt: number
  intervalDays: number
  stability: number
  difficulty: number
  state: number
}

export type FsrsShadowReplayEventV1 = {
  schemaVersion: typeof FSRS_SHADOW_SCHEMA_VERSION
  libraryVersion: typeof FSRS_SHADOW_LIBRARY_VERSION
  algorithmModel: typeof FSRS_SHADOW_ALGORITHM_MODEL
  parameterSetId: typeof FSRS_SHADOW_PARAMETER_SET_ID
  dict: string
  word: string
  sourceRecordId?: number
  eventTime: number
  rating: ShadowReviewOutcome
  retrievabilityBefore: number | null
  before: FsrsShadowCardSnapshotV1
  after: FsrsShadowCardSnapshotV1
  selectedIntervalDays: number
  counterfactual: Record<ShadowReviewOutcome, FsrsCounterfactualV1>
}

export type FsrsShadowReplayResultV1 = {
  schemaVersion: typeof FSRS_SHADOW_SCHEMA_VERSION
  libraryVersion: typeof FSRS_SHADOW_LIBRARY_VERSION
  algorithmModel: typeof FSRS_SHADOW_ALGORITHM_MODEL
  parameterSetId: typeof FSRS_SHADOW_PARAMETER_SET_ID
  dict: string
  word: string
  historyCoverage: FsrsHistoryCoverage
  currentReviewCount: number | null
  replayedEligibleEvents: number
  ignoredEvents: number
  card: FsrsShadowCardSnapshotV1
  events: FsrsShadowReplayEventV1[]
}

const shadowScheduler = fsrs({
  request_retention: 0.84,
  maximum_interval: 36500,
  enable_fuzz: false,
  enable_short_term: false,
  learning_steps: [],
  relearning_steps: [],
})

type FsrsGrade =
  | Rating.Again
  | Rating.Hard
  | Rating.Good
  | Rating.Easy

const outcomeToRating: Record<ShadowReviewOutcome, FsrsGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}

const outcomes: ShadowReviewOutcome[] = [
  'again',
  'hard',
  'good',
  'easy',
]

function toDate(timestamp: number): Date {
  return new Date(timestamp * 1000)
}

function toTimestamp(date?: Date): number | null {
  return date ? Math.floor(date.getTime() / 1000) : null
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function snapshot(card: Card): FsrsShadowCardSnapshotV1 {
  return {
    dueAt: Math.floor(card.due.getTime() / 1000),
    lastReviewAt: toTimestamp(card.last_review),
    stability: round6(card.stability),
    difficulty: round6(card.difficulty),
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    learningSteps: card.learning_steps,
    state: card.state,
  }
}

function intervalDays(now: Date, due: Date): number {
  return round6(Math.max(0, due.getTime() - now.getTime()) / DAY_MS)
}

function isEligibleReview(
  record: FsrsReplayRecord,
): record is FsrsReplayRecord & {
  reviewRatingDecision: {
    eligible: true
    rating: ShadowReviewOutcome
  }
} {
  return (
    record.sourceMode !== 'typing' &&
    record.learnItemKind !== 'acquisition' &&
    record.reviewRatingDecision?.eligible === true
  )
}

function compareRecords(left: FsrsReplayRecord, right: FsrsReplayRecord) {
  if (left.timeStamp !== right.timeStamp) {
    return left.timeStamp - right.timeStamp
  }

  return (left.id ?? Number.MAX_SAFE_INTEGER) -
    (right.id ?? Number.MAX_SAFE_INTEGER)
}

function coverageFor(
  replayedEligibleEvents: number,
  currentState?: FsrsReplayCurrentState,
): FsrsHistoryCoverage {
  if (!currentState) return 'unknown'
  if (currentState.reviewCount === replayedEligibleEvents) {
    return 'review-count-matched'
  }
  if (currentState.reviewCount > replayedEligibleEvents) {
    return 'partial-history'
  }
  return 'event-count-exceeds-state'
}

export function replayFsrsShadowForWord(input: {
  dict: string
  word: string
  records: readonly FsrsReplayRecord[]
  currentState?: FsrsReplayCurrentState
}): FsrsShadowReplayResultV1 {
  const records = input.records
    .filter(
      (record) =>
        record.dict === input.dict && record.word === input.word,
    )
    .slice()
    .sort(compareRecords)

  const acquisition = records.find(
    (record) =>
      record.sourceMode !== 'typing' &&
      record.learnItemKind === 'acquisition',
  )
  const eligible = records.filter(isEligibleReview)

  const birthTime =
    acquisition?.timeStamp ??
    eligible[0]?.timeStamp ??
    Math.floor(Date.now() / 1000)

  let card = createEmptyCard(toDate(birthTime))
  const events: FsrsShadowReplayEventV1[] = []

  for (const record of eligible) {
    const now = toDate(record.timeStamp)
    const before = snapshot(card)
    const retrievabilityBefore =
      card.state === State.New
        ? null
        : round6(shadowScheduler.get_retrievability(card, now, false))

    const preview = shadowScheduler.repeat(card, now)
    const counterfactual = {} as Record<
      ShadowReviewOutcome,
      FsrsCounterfactualV1
    >

    for (const outcome of outcomes) {
      const candidate = preview[outcomeToRating[outcome]].card
      counterfactual[outcome] = {
        dueAt: Math.floor(candidate.due.getTime() / 1000),
        intervalDays: intervalDays(now, candidate.due),
        stability: round6(candidate.stability),
        difficulty: round6(candidate.difficulty),
        state: candidate.state,
      }
    }

    const rating = record.reviewRatingDecision.rating
    const next = shadowScheduler.next(
      card,
      now,
      outcomeToRating[rating],
    )
    card = next.card

    events.push({
      schemaVersion: FSRS_SHADOW_SCHEMA_VERSION,
      libraryVersion: FSRS_SHADOW_LIBRARY_VERSION,
      algorithmModel: FSRS_SHADOW_ALGORITHM_MODEL,
      parameterSetId: FSRS_SHADOW_PARAMETER_SET_ID,
      dict: input.dict,
      word: input.word,
      sourceRecordId: record.id,
      eventTime: record.timeStamp,
      rating,
      retrievabilityBefore,
      before,
      after: snapshot(card),
      selectedIntervalDays: intervalDays(now, card.due),
      counterfactual,
    })
  }

  return {
    schemaVersion: FSRS_SHADOW_SCHEMA_VERSION,
    libraryVersion: FSRS_SHADOW_LIBRARY_VERSION,
    algorithmModel: FSRS_SHADOW_ALGORITHM_MODEL,
    parameterSetId: FSRS_SHADOW_PARAMETER_SET_ID,
    dict: input.dict,
    word: input.word,
    historyCoverage: coverageFor(
      events.length,
      input.currentState,
    ),
    currentReviewCount: input.currentState?.reviewCount ?? null,
    replayedEligibleEvents: events.length,
    ignoredEvents: records.length - events.length,
    card: snapshot(card),
    events,
  }
}

export function replayFsrsShadowHistory(input: {
  records: readonly FsrsReplayRecord[]
  currentStates?: readonly FsrsReplayCurrentState[]
}): FsrsShadowReplayResultV1[] {
  const keys = new Map<string, { dict: string; word: string }>()

  for (const record of input.records) {
    if (
      record.sourceMode === 'typing' ||
      (record.learnItemKind !== 'acquisition' && !isEligibleReview(record))
    ) {
      continue
    }

    const key = `${record.dict}\u0000${record.word}`
    keys.set(key, { dict: record.dict, word: record.word })
  }

  const currentByKey = new Map(
    (input.currentStates ?? []).map((state) => [
      `${state.dict}\u0000${state.word}`,
      state,
    ]),
  )

  return [...keys.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, identity]) =>
      replayFsrsShadowForWord({
        ...identity,
        records: input.records,
        currentState: currentByKey.get(key),
      }),
    )
}
