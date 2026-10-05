import { Rating, State, createEmptyCard } from 'ts-fsrs'
import type { Card } from 'ts-fsrs'
import {
  FSRS_SHADOW_ALGORITHM_MODEL,
  FSRS_SHADOW_LIBRARY_VERSION,
  FSRS_SHADOW_PARAMETER_SET_ID,
  FSRS_SHADOW_SCHEMA_VERSION,
} from './types'
import type {
  FsrsCounterfactualV1,
  FsrsHistoryCoverage,
  FsrsShadowCardSnapshotV1,
  FsrsShadowReplayEventV1,
  FsrsShadowReplayResultV1,
} from './types'
import { createFsrs6Scheduler } from './strategy'
import type { IReviewWordState, ReviewOutcome } from '../types'
import type { IWordRecord } from '@/utils/db/record'

const DAY_MS = 24 * 60 * 60 * 1000

type FsrsGrade =
  | Rating.Again
  | Rating.Hard
  | Rating.Good
  | Rating.Easy

const outcomeToRating: Record<ReviewOutcome, FsrsGrade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}

const outcomes: ReviewOutcome[] = ['again', 'hard', 'good', 'easy']

const shadowScheduler = createFsrs6Scheduler()

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
  record: IWordRecord,
): record is IWordRecord & {
  reviewRatingDecision: {
    eligible: true
    rating: ReviewOutcome
    confidence: number
    reasonCodes: string[]
  }
} {
  return (
    record.sourceMode !== 'typing' &&
    record.learnItemKind !== 'acquisition' &&
    record.reviewRatingDecision?.eligible === true
  )
}

export function compareFsrsReplayRecordOrder(
  left: IWordRecord,
  right: IWordRecord,
): number {
  if (left.timeStamp !== right.timeStamp) {
    return left.timeStamp - right.timeStamp
  }

  return (
    (left.id ?? Number.MAX_SAFE_INTEGER) -
    (right.id ?? Number.MAX_SAFE_INTEGER)
  )
}

function coverageFor(
  replayedEligibleEvents: number,
  currentState?: Pick<IReviewWordState, 'reviewCount'>,
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
  records: readonly IWordRecord[]
  currentState?: Pick<IReviewWordState, 'reviewCount'>
}): FsrsShadowReplayResultV1 {
  const records = input.records
    .filter(
      (record) =>
        record.dict === input.dict && record.word === input.word,
    )
    .slice()
    .sort(compareFsrsReplayRecordOrder)

  const acquisition = records.find(
    (record) =>
      record.sourceMode !== 'typing' &&
      record.learnItemKind === 'acquisition',
  )
  const eligible = records.filter(isEligibleReview)
  const birthTime = acquisition?.timeStamp ?? eligible[0]?.timeStamp ?? 0

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
      ReviewOutcome,
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
    historyCoverage: coverageFor(events.length, input.currentState),
    currentReviewCount: input.currentState?.reviewCount ?? null,
    replayedEligibleEvents: events.length,
    ignoredEvents: records.length - events.length,
    card: snapshot(card),
    events,
  }
}
