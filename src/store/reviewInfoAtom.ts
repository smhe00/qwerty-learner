import { appendDeveloperTrace } from '@/dev/diagnostic-trace'
import { createSerializedSnapshotWriter } from '@/review/persistence'
import type { ReviewRecord } from '@/utils/db/record'
import { putWordReviewRecord } from '@/utils/db/review-record'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

const reviewRecordWriter = createSerializedSnapshotWriter(
  putWordReviewRecord,
)

function sameReviewSession(
  left: ReviewRecord | undefined,
  right: ReviewRecord | undefined,
) {
  if (!left || !right) return false
  if (left.id !== undefined && right.id !== undefined) {
    return left.id === right.id
  }
  return (
    left.dict === right.dict &&
    left.createTime === right.createTime
  )
}

function queueReviewRecordWrite(record: ReviewRecord) {
  // Persist an immutable snapshot in the same order as UI state transitions.
  // Without serialization, an older unfinished checkpoint can complete after
  // the final finished write and resurrect a stale Learn session on reload.
  void reviewRecordWriter.enqueue(record)
}

export type TReviewInfoAtomData = {
  isReviewMode: boolean
  reviewRecord: ReviewRecord | undefined
}

export function readStoredReviewInfo(
  fallback: TReviewInfoAtomData,
): TReviewInfoAtomData {
  if (typeof window === 'undefined') return fallback

  const raw = window.localStorage.getItem('reviewModeInfo')
  if (!raw) return fallback

  try {
    const parsed = JSON.parse(raw) as Partial<TReviewInfoAtomData>
    if (typeof parsed?.isReviewMode !== 'boolean') return fallback

    return {
      isReviewMode: parsed.isReviewMode,
      reviewRecord: parsed.reviewRecord,
    }
  } catch {
    return fallback
  }
}

export function reviewInfoAtom(initialValue: TReviewInfoAtomData) {
  // reviewModeInfo is route-critical state. Reading the synchronous localStorage
  // snapshot as the atom's initial value removes the first-render hydration
  // window where a valid Learn session could momentarily look like Typing.
  const storageAtom = atomWithStorage(
    'reviewModeInfo',
    readStoredReviewInfo(initialValue),
  )

  return atom(
    (get) => {
      return get(storageAtom)
    },
    (get, set, updater: TReviewInfoAtomData | ((oldValue: TReviewInfoAtomData) => TReviewInfoAtomData)) => {
      const oldValue = get(storageAtom)
      let newValue =
        typeof updater === 'function' ? updater(oldValue) : updater

      // Session completion is terminal. A delayed closure is never allowed to
      // resurrect the same session after isFinished became true.
      if (
        oldValue.reviewRecord?.isFinished &&
        newValue.reviewRecord &&
        !newValue.reviewRecord.isFinished &&
        sameReviewSession(oldValue.reviewRecord, newValue.reviewRecord)
      ) {
        newValue = {
          ...newValue,
          reviewRecord: oldValue.reviewRecord,
        }
      }

      // Keep local route-critical state synchronous, while serializing durable
      // checkpoints so IndexedDB can never finish them out of order.
      if (newValue.reviewRecord?.id) {
        appendDeveloperTrace({
          scope: 'persistence',
          event: 'review-checkpoint-requested',
          sessionId: String(newValue.reviewRecord.id),
          index: newValue.reviewRecord.index,
          queueLength: newValue.reviewRecord.words.length,
          details: {
            isFinished: newValue.reviewRecord.isFinished,
          },
        })
        queueReviewRecordWrite(newValue.reviewRecord)
      }

      try {
        set(storageAtom, newValue)
        if (newValue.reviewRecord) {
          appendDeveloperTrace({
            scope: 'persistence',
            event: 'review-route-cache-committed',
            sessionId: String(
              newValue.reviewRecord.id ??
                newValue.reviewRecord.createTime,
            ),
            index: newValue.reviewRecord.index,
            queueLength: newValue.reviewRecord.words.length,
            details: {
              isFinished: newValue.reviewRecord.isFinished,
            },
          })
        }
      } catch (error) {
        appendDeveloperTrace({
          scope: 'persistence',
          event: 'review-route-cache-error',
          sessionId: newValue.reviewRecord
            ? String(
                newValue.reviewRecord.id ??
                  newValue.reviewRecord.createTime,
              )
            : undefined,
          index: newValue.reviewRecord?.index,
          queueLength: newValue.reviewRecord?.words.length,
          details: {
            message:
              error instanceof Error
                ? error.message
                : String(error),
          },
        })
        throw error
      }
    },
  )
}
