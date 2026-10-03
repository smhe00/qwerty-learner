import type {
  FsrsLiveShadowObservationV1,
  FsrsShadowReplayResultV1,
} from './types'
import type { IReviewWordState } from '../types'

export function buildFsrsLiveShadowObservation(input: {
  replay: FsrsShadowReplayResultV1
  sourceRecordId: number
  basicState: IReviewWordState
}): FsrsLiveShadowObservationV1 | undefined {
  if (input.basicState.schedulerState.kind !== 'basic-v2') {
    return undefined
  }

  const event = input.replay.events.find(
    (candidate) => candidate.sourceRecordId === input.sourceRecordId,
  )
  if (!event) return undefined

  return {
    ...event,
    historyCoverage: input.replay.historyCoverage,
    replayedEligibleEvents: input.replay.replayedEligibleEvents,
    basicV2: {
      dueAt: input.basicState.nextReviewAt,
      nominalIntervalDays:
        input.basicState.schedulerState.intervalDays,
      reviewCount: input.basicState.reviewCount,
      lapseCount: input.basicState.lapseCount,
    },
  }
}
