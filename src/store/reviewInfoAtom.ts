import type { ReviewRecord } from '@/utils/db/record'
import { putWordReviewRecord } from '@/utils/db/review-record'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

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
      const newValue = typeof updater === 'function' ? updater(get(storageAtom)) : updater

      // update reviewRecord to indexdb
      if (newValue.reviewRecord?.id) {
        putWordReviewRecord(newValue.reviewRecord)
      }
      set(storageAtom, newValue)
    },
  )
}
