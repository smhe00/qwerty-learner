import {
  countTodayIntroducedLearnWords,
  deriveLearnLiveStats,
} from '@/learn/live-stats'
import { TypingContext } from '@/pages/Typing/store'
import InfoBox from '@/pages/Typing/components/Speed/InfoBox'
import { memoryConfigAtom, reviewModeInfoAtom } from '@/store'
import { db } from '@/utils/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue } from 'jotai'
import { useContext, useMemo, useRef } from 'react'

function formatClock(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const rest = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/**
 * Learn-only live strip.
 *
 * It replaces the Typing `Speed` component exclusively on the Learn surface
 * and reuses the same visual primitive, so Typing keeps its own statistics,
 * labels and semantics untouched.
 */
export default function LearnLiveStats() {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state } = useContext(TypingContext)!
  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const memoryConfig = useAtomValue(memoryConfigAtom)
  const record = reviewModeInfo.reviewRecord
  const dict = record?.dict

  // Dexie re-runs this query only when the underlying table changes, which in
  // practice means once per durable word result. There is no per-keystroke or
  // interval-based database read here.
  const wordRecords = useLiveQuery(
    async () => {
      if (!dict) return []
      try {
        return await db.wordRecords.where('dict').equals(dict).toArray()
      } catch (error) {
        // A failed evidence read must never take the Learn surface down. The
        // strip degrades to the session-derived counters instead.
        console.error('failed to read Learn live stats evidence', error)
        return []
      }
    },
    [dict],
    [],
  )

  const evidence = useMemo(
    () =>
      deriveLearnLiveStats({
        reviewRecord: record,
        wordRecords: wordRecords ?? [],
      }),
    [record, wordRecords],
  )

  const todayIntroducedWords = useMemo(
    () =>
      countTodayIntroducedLearnWords({
        dict,
        wordRecords: wordRecords ?? [],
      }),
    [dict, wordRecords],
  )

  const sessionKey = record
    ? `${record.dict}:${String(record.id ?? record.createTime)}`
    : ''

  // Progress is monotonic inside one session. A recovered checkpoint may
  // momentarily resolve a smaller number than the value already shown, so the
  // displayed value never walks backwards while the learner is active.
  const progressFloorRef = useRef<{ key: string; value: number }>({
    key: '',
    value: 0,
  })
  if (progressFloorRef.current.key !== sessionKey) {
    progressFloorRef.current = { key: sessionKey, value: 0 }
  }
  const completedLogicalWords = Math.min(
    Math.max(evidence.completedLogicalWords, progressFloorRef.current.value),
    evidence.totalLogicalWords,
  )
  progressFloorRef.current.value = completedLogicalWords

  return (
    <div
      className="my-card flex w-3/5 rounded-xl bg-white p-4 py-10 opacity-50 transition-colors duration-300 dark:bg-gray-800"
      data-learn-live-stats
    >
      <InfoBox
        info={formatClock(state.timerData.time)}
        description="学习时间"
      />
      <InfoBox
        info={`${completedLogicalWords}/${evidence.totalLogicalWords}`}
        description="本轮进度"
      />
      <InfoBox
        info={`${todayIntroducedWords}/${memoryConfig.dailyNewWordTarget}`}
        description="今日新词"
      />
      <InfoBox info={evidence.reviewedWords + ''} description="已复习" />
      <InfoBox
        info={evidence.independentRecallWords + ''}
        description="独立回忆"
      />
    </div>
  )
}
