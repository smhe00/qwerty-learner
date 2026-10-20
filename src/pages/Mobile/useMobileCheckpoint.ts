import { useAtomValue } from 'jotai'
import { useLiveQuery } from 'dexie-react-hooks'
import { currentDictIdAtom, reviewModeInfoAtom } from '@/store'
import { db } from '@/utils/db/core'
import { pickMobileCheckpoint } from './model'

/** Shared read-only checkpoint projection for menu and study.
 * No prepareLearnSession, getLatestReviewRecord (which repairs/writes), or
 * setter of reviewModeInfoAtom may be used in this hook.
 */
export function useMobileCheckpoint() {
  const dict = useAtomValue(currentDictIdAtom)
  const review = useAtomValue(reviewModeInfoAtom)
  const saved = useLiveQuery(
    () => db.reviewRecords.where('dict').equals(dict).toArray(),
    [dict],
    [],
  )
  const checkpoint = pickMobileCheckpoint(
    dict,
    review.isReviewMode ? review.reviewRecord : undefined,
    saved ?? [],
  )
  return { dict, checkpoint }
}
