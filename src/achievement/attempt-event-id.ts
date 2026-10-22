/**
 * Achievement event IDs now follow immutable WordRecord attempt identity.
 *
 * Origin-local numeric IDs collide on different devices. Old numeric IDs
 * remain supported for idempotence and historical archives, but a NEW UUID
 * backed attempt receives a globally unique event identity.
 */
import { isLearningAttemptId } from '@/utils/db/attempt-identity'
import type { IWordRecord } from '@/utils/db/record'

export function achievementAttemptEventIds(
  type: 'word' | 'mastery',
  sourceRecordId: number,
  record: Pick<IWordRecord, 'attemptId'>,
): { primary: string; all: string[] } {
  if (!Number.isSafeInteger(sourceRecordId) || sourceRecordId < 1) {
    throw new Error('achievement-invalid-numeric-source-id')
  }
  const legacy = type + ':' + sourceRecordId
  if (record.attemptId !== undefined &&
      !isLearningAttemptId(record.attemptId)) {
    throw new Error('achievement-invalid-immutable-attempt-id')
  }
  const primary = record.attemptId
    ? type + ':' + record.attemptId
    : legacy
  return { primary, all: primary === legacy ? [legacy] : [primary, legacy] }
}
