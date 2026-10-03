import { buildFsrsLiveShadowObservation } from './observation'
import {
  compareFsrsReplayRecordOrder,
  replayFsrsShadowForWord,
} from './replay'
import type { FsrsLiveShadowObservationV1 } from './types'
import type { IReviewWordState } from '../types'
import { db } from '@/utils/db'

export async function persistFsrsLiveShadowObservation(input: {
  dict: string
  word: string
  sourceRecordId: number
  basicState: IReviewWordState
}): Promise<FsrsLiveShadowObservationV1 | undefined> {
  return db.transaction('rw', db.wordRecords, async () => {
    const current = await db.wordRecords.get(input.sourceRecordId)
    if (
      !current ||
      current.dict !== input.dict ||
      current.word !== input.word ||
      current.reviewRatingDecision?.eligible !== true
    ) {
      return undefined
    }

    const records = await db.wordRecords
      .where('word')
      .equals(input.word)
      .and((record) => record.dict === input.dict)
      .toArray()

    const boundedRecords = records.filter(
      (record) =>
        compareFsrsReplayRecordOrder(record, current) <= 0,
    )

    const replay = replayFsrsShadowForWord({
      dict: input.dict,
      word: input.word,
      records: boundedRecords,
      currentState: {
        reviewCount: input.basicState.reviewCount,
      },
    })
    const observation = buildFsrsLiveShadowObservation({
      replay,
      sourceRecordId: input.sourceRecordId,
      basicState: input.basicState,
    })
    if (!observation) return undefined

    await db.wordRecords.update(input.sourceRecordId, {
      fsrsShadow: observation,
    })

    return observation
  })
}
