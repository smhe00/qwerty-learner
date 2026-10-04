import {
  getUnseenAchievementStates,
  markAchievementSeen,
  processLiveLearnSessionCompletion,
  recordVoluntaryContinueIntent,
} from '@/achievement'
import { getAchievementSessionId } from '@/achievement/session'
import { TypingContext } from '@/pages/Typing/store'
import { getAchievementCulture } from '@/resources/achievementCulture'
import {
  currentDictInfoAtom,
  reviewModeInfoAtom,
} from '@/store'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useContext, useEffect, useMemo } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import IconX from '~icons/tabler/x'

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

function SummaryMetric({
  label,
  value,
  detail,
}: {
  label: string
  value: string | number
  detail?: string
}) {
  return (
    <div className="min-w-36 rounded-2xl bg-indigo-50 px-6 py-5 text-center dark:bg-gray-700">
      <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-2 text-3xl font-semibold text-gray-700 dark:text-white">
        {value}
      </div>
      {detail ? (
        <div className="mt-1 text-xs text-gray-400 dark:text-gray-500">
          {detail}
        </div>
      ) : null}
    </div>
  )
}

export default function LearnResultScreen() {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const { state } = useContext(TypingContext)!
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const navigate = useNavigate()
  const unseenAchievementStates = useLiveQuery(
    () => getUnseenAchievementStates(),
    [],
    [],
  )

  const newAchievements = useMemo(
    () =>
      unseenAchievementStates.flatMap((state) => {
        const culture = getAchievementCulture(state.achievementId)
        return culture ? [{ state, ...culture }] : []
      }),
    [unseenAchievementStates],
  )

  const acknowledgeAchievements = useCallback(() => {
    for (const item of newAchievements) {
      void markAchievementSeen(item.state.achievementId).catch((error) => {
        console.error('failed to mark achievement seen', error)
      })
    }
  }, [newAchievements])

  const record = reviewModeInfo.reviewRecord
  const isAcquisition = record?.sessionKind === 'acquisition'

  useEffect(() => {
    if (!record || state.chapterData.wordRecordIds.length === 0) return

    void processLiveLearnSessionCompletion({
      sessionId: getAchievementSessionId(record),
      dict: record.dict,
      sourceRecordIds: [...state.chapterData.wordRecordIds],
      completedAt: Math.floor(Date.now() / 1000),
      recommendedGoalCompleted:
        record.isFinished &&
        record.recommendedGoal?.version === 1,
    }).catch((error) => {
      console.error('failed to process achievement session completion', error)
    })
  }, [record, state.chapterData.wordRecordIds])

  const uniqueWordCount = useMemo(
    () =>
      new Set(record?.words.map((word) => word.name) ?? []).size,
    [record?.words],
  )

  const independentMastered = useMemo(() => {
    if (!isAcquisition) return 0
    return Object.values(record?.acquisitionStates ?? {}).filter(
      (item) => item.phase === 'complete',
    ).length
  }, [isAcquisition, record?.acquisitionStates])

  const needsConsolidation = isAcquisition
    ? Math.max(0, uniqueWordCount - independentMastered)
    : 0

  const leaveLearn = useCallback(() => {
    setReviewModeInfo((old) => ({
      ...old,
      isReviewMode: false,
    }))
  }, [setReviewModeInfo])

  const continueLearn = useCallback(() => {
    const proceed = () => {
      acknowledgeAchievements()
      leaveLearn()
      navigate('/learn')
    }

    if (
      !record ||
      !record.isFinished ||
      record.recommendedGoal?.version !== 1
    ) {
      proceed()
      return
    }

    void recordVoluntaryContinueIntent({
      completedSessionId: getAchievementSessionId(record),
      dict: record.dict,
      occurredAt: Math.floor(Date.now() / 1000),
    })
      .catch((error) => {
        console.error(
          'failed to persist voluntary continue intent',
          error,
        )
      })
      .finally(proceed)
  }, [
    acknowledgeAchievements,
    leaveLearn,
    navigate,
    record,
  ])

  const chooseDictionary = useCallback(() => {
    acknowledgeAchievements()
    leaveLearn()
    navigate('/gallery?mode=learn')
  }, [acknowledgeAchievements, leaveLearn, navigate])

  const returnToTyping = useCallback(() => {
    acknowledgeAchievements()
    leaveLearn()
    navigate('/typing')
  }, [acknowledgeAchievements, leaveLearn, navigate])

  useHotkeys(
    'enter',
    () => continueLearn(),
    { preventDefault: true },
    [continueLearn],
  )
  useHotkeys(
    'esc',
    () => returnToTyping(),
    { preventDefault: true },
    [returnToTyping],
  )

  return (
    <div
      className="fixed inset-0 z-30 overflow-y-auto"
      data-learn-result-screen
    >
      <div className="absolute inset-0 bg-gray-200/95 backdrop-blur-sm dark:bg-gray-900/90" />
      <div className="relative flex min-h-screen items-center justify-center py-8">
        <div className="my-card relative flex w-[90vw] max-w-3xl flex-col rounded-3xl bg-white px-10 py-10 shadow-lg dark:bg-gray-800">
          <button
            type="button"
            className="absolute right-7 top-5"
            onClick={returnToTyping}
            aria-label="结束 Learn 并返回 Typing"
            title="结束 Learn 并返回 Typing"
          >
            <IconX className="text-gray-400" />
          </button>

          <div className="text-center">
            <div className="text-sm text-gray-400">
              {currentDictInfo.name} · Learn
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-gray-800 dark:text-gray-100">
              本轮学习完成
            </h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {isAcquisition
                ? '需要继续巩固的词会由 Learn 自动安排，不需要现在重做。'
                : '本轮复习已经完成，后续间隔由 Learn 自动安排。'}
            </p>
          </div>

          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <SummaryMetric
              label={isAcquisition ? '本轮学习' : '本轮复习'}
              value={uniqueWordCount}
              detail="词"
            />
            {isAcquisition ? (
              <>
                <SummaryMetric
                  label="独立掌握"
                  value={independentMastered}
                  detail="已能独立拼写"
                />
                <SummaryMetric
                  label="继续巩固"
                  value={needsConsolidation}
                  detail="系统会自动再安排"
                />
              </>
            ) : null}
            <SummaryMetric
              label="本轮用时"
              value={formatTime(state.timerData.time)}
            />
          </div>

          {newAchievements.length > 0 ? (
            <section
              className="mt-8 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-6 py-5 text-left dark:border-gray-700 dark:bg-gray-700/60"
              aria-label="本轮新成就"
              data-achievement-settlement
            >
              <div className="text-center">
                <div className="text-xs font-medium tracking-[0.18em] text-indigo-400">
                  本轮新成就
                </div>
                <div className="mt-1 text-sm text-gray-500 dark:text-gray-300">
                  记录真正发生的能力变化，不奖励机械刷次数。
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {newAchievements.map(({ achievement, primary, state }) => (
                  <article
                    key={state.achievementId}
                    className="rounded-xl bg-white px-4 py-4 shadow-sm dark:bg-gray-800"
                    data-achievement-id={state.achievementId}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-gray-800 dark:text-gray-100">
                          {achievement.title}
                        </div>
                        <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                          {achievement.copy.unlockMessage}
                        </div>
                      </div>
                      {achievement.hidden ? (
                        <span className="shrink-0 rounded-full bg-indigo-100 px-2 py-1 text-[11px] text-indigo-500 dark:bg-gray-700 dark:text-indigo-300">
                          隐藏成就
                        </span>
                      ) : null}
                    </div>

                    {primary ? (
                      <div className="mt-3 border-l-2 border-indigo-200 pl-3 dark:border-indigo-500/40">
                        <div className="text-sm text-gray-600 dark:text-gray-300">
                          {primary.text}
                        </div>
                        <div className="mt-1 text-xs text-gray-400">
                          {primary.source}
                        </div>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <button
              className="my-btn-primary h-12 px-6 text-base font-bold"
              type="button"
              onClick={continueLearn}
              title="继续 Learn"
            >
              继续 Learn
            </button>
            <button
              className="my-btn-primary h-12 border-2 border-solid border-gray-300 bg-white px-6 text-base text-gray-700 dark:border-gray-700 dark:bg-gray-600 dark:text-white"
              type="button"
              onClick={chooseDictionary}
              title="选择其他词库"
            >
              选择其他词库
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
