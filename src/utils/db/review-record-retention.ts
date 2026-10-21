import type { IReviewRecord } from './record'

/**
 * Completed sessions are immutable, terminal checkpoints. Their full Word[]
 * dictionaries, spelling hints, exercise plans and item machine are only
 * needed while the session is unfinished.
 *
 * The durable acquisitionStates map MUST stay: startup recovery walks every
 * historical reviewRecord and uses the newest state for each pending word.
 * Event/session provenance, timestamps, word cursor, and goal metadata survive.
 *
 * Pure and idempotent. Only called when a checkpoint is explicitly marked
 * isFinished=true at the serialized IndexedDB write boundary. It is NOT an
 * automatic migration of previously written history.
 */
export function compactFinishedReviewRecord<T extends IReviewRecord>(record: T): IReviewRecord {
  if (!record.isFinished) return record

  return {
    ...(record.id === undefined ? {} : { id: record.id }),
    // Compaction must preserve cross-device provenance, including after reload.
    ...(record.sessionId === undefined ? {} : { sessionId: record.sessionId }),
    dict: record.dict,
    index: record.index,
    createTime: record.createTime,
    isFinished: true,
    words: [],
    ...(record.blockSize === undefined ? {} : { blockSize: record.blockSize }),
    ...(record.sessionKind === undefined ? {} : { sessionKind: record.sessionKind }),
    ...(record.acquisitionStates === undefined ? {} : {
      acquisitionStates: record.acquisitionStates,
    }),
    ...(record.recommendedGoal === undefined ? {} : {
      recommendedGoal: record.recommendedGoal,
    }),
  }
}
