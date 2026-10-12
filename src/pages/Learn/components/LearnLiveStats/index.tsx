import {
  deriveLearnDailyProgress,
  deriveLearnExecutionProgress,
  getLearnExtraRoundNames,
  loadLearnDailySession,
} from '@/learn/daily-session'
import { TypingContext } from '@/pages/Typing/store'
import InfoBox from '@/pages/Typing/components/Speed/InfoBox'
import { reviewModeInfoAtom } from '@/store'
import { db } from '@/utils/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue } from 'jotai'
import { useContext, useMemo } from 'react'

function formatClock(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const rest = safeSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

/**
 * Learn-only daily strip.
 *
 * Blocks are intentionally invisible here: the learner sees one daily plan
 * whose progress advances only when a logical word reaches its final required
 * independent-clean completion.
 */
export default function LearnLiveStats() {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const { state } = useContext(TypingContext)!
  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const record = reviewModeInfo.reviewRecord
  const dict = record?.dict

  const wordRecords = useLiveQuery(
    async () => {
      if (!dict) return []
      try {
        return await db.wordRecords.where('dict').equals(dict).toArray()
      } catch (error) {
        console.error('failed to read Learn daily stats evidence', error)
        return []
      }
    },
    [dict],
    [],
  )

  // DailySession may be created by a recovery/migration effect after this
  // component mounts. Read the tiny localStorage checkpoint on each render so
  // the next timer/Dexie update immediately exposes the daily plan.
  const daily = dict ? loadLearnDailySession(dict) : null

  const progress = useMemo(() => {
    if (!daily) return null
    return deriveLearnDailyProgress({
      session: daily,
      wordRecords: wordRecords ?? [],
    })
  }, [daily, wordRecords])

  const extraProgress = daily && getLearnExtraRoundNames(daily) ? deriveLearnExecutionProgress({ session: daily, wordRecords: wordRecords ?? [] }) : null

  const dailySeconds =
    (daily?.accumulatedActiveSeconds ?? 0) + state.timerData.time

  return (
    <div
      className="focus-stats-strip"
      data-learn-live-stats
      data-stat-count={extraProgress ? 6 : 5}
    >
      <InfoBox
        info={formatClock(dailySeconds)}
        description="学习时间"
      />
      {extraProgress ? <InfoBox info={`${extraProgress.completedWords}/${extraProgress.targetWords}`} description="本轮加学" /> : null}
      <InfoBox
        info={
          progress
            ? `${progress.completedWords}/${progress.targetWords}`
            : '0/0'
        }
        description="今日进度"
        prominent
      />
      <InfoBox
        info={
          daily && progress
            ? `${progress.introducedNewWords}/${progress.newTargetWords}`
            : '0/0'
        }
        description="今日新词"
      />
      <InfoBox
        info={
          progress
            ? `${progress.completedReviewWords}/${progress.reviewTargetWords}`
            : '0/0'
        }
        description="今日复习"
      />
      <InfoBox
        info={String(extraProgress?.remainingWords ?? progress?.remainingWords ?? 0)}
        description={extraProgress ? '本轮待完成' : '待完成'}
      />
    </div>
  )
}
