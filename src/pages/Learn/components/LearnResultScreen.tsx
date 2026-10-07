import {
  getUnseenAchievementStates,
  markAchievementSeen,
  processLiveLearnSessionCompletion,
} from '@/achievement'
import { resolveAchievementCeremonyPresentation } from '@/achievement/presentation'
import { getAchievementSessionId } from '@/achievement/session'
import {
  completeLearnDailySession,
  deriveLearnDailyProgress,
  loadLearnDailySession,
  recordLearnBlockCompletion,
} from '@/learn/daily-session'
import type {
  LearnDailyProgress,
  LearnDailySessionV1,
} from '@/learn/daily-session'
import { flushLearnPersistence } from '@/learn/persistence'
import {
  TypingContext,
  TypingStateActionType,
} from '@/pages/Typing/store'
import { getAchievementCulture } from '@/resources/achievementCulture'
import { currentDictInfoAtom, reviewModeInfoAtom } from '@/store'
import {
  autoSyncCompletedLearnSession,
} from '@/sync/auto'
import type { LearnAutoSyncResult } from '@/sync/auto'
import { db } from '@/utils/db'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router-dom'
import IconX from '~icons/tabler/x'

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  const rest = safe % 60
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
    <div className="min-w-32 rounded-2xl bg-indigo-50 px-5 py-4 text-center dark:bg-gray-700">
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {label}
      </div>
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

type Settlement = {
  session: LearnDailySessionV1
  progress: LearnDailyProgress
  sync?: LearnAutoSyncResult
}

function syncText(sync: LearnAutoSyncResult | undefined): string | null {
  if (!sync) return null

  switch (sync.status) {
    case 'uploaded':
      return `云同步完成 · revision ${sync.revision}`
    case 'clean':
      return '本地与云端已一致'
    case 'not-logged-in':
      return '未登录云端，学习记录已安全保存在本机'
    case 'remote-ahead':
      return '云端有较新数据，已停止自动上传，请稍后手动处理'
    case 'diverged':
      return '本地与云端都有变化，已停止自动上传，请稍后手动处理'
    case 'conflict':
      return '自动同步时检测到云端变化，未覆盖云端数据'
    case 'failed':
      return '本地记录已保存；本次云同步失败，可稍后重试'
  }
}

export default function LearnResultScreen() {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const navigate = useNavigate()
  const record = reviewModeInfo.reviewRecord
  const [settlement, setSettlement] = useState<Settlement | null>(null)
  const [settlementError, setSettlementError] = useState('')
  // React StrictMode replays effects in development. Keep the actual durable
  // settlement in a stable Promise so replayed effects subscribe to the same
  // operation instead of cancelling the only run and leaving Pause disabled.
  const settlementPromiseRef = useRef<Promise<Settlement> | null>(null)
  const syncPromiseRef = useRef<Promise<LearnAutoSyncResult> | null>(null)

  const unseenAchievementStates = useLiveQuery(
    () => getUnseenAchievementStates(),
    [],
    [],
  )
  const newAchievements = useMemo(
    () =>
      unseenAchievementStates.flatMap((achievementState) => {
        const culture = getAchievementCulture(
          achievementState.achievementId,
        )
        return culture
          ? [{ state: achievementState, ...culture }]
          : []
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

  useEffect(() => {
    if (!record) return

    let active = true

    if (!settlementPromiseRef.current) {
      const recordSnapshot = structuredClone(record)
      const sourceRecordIds = [...state.chapterData.wordRecordIds]
      const activeSeconds = state.timerData.time

      settlementPromiseRef.current = (async (): Promise<Settlement> => {
        if (sourceRecordIds.length > 0) {
          try {
            await processLiveLearnSessionCompletion({
              sessionId: getAchievementSessionId(recordSnapshot),
              dict: recordSnapshot.dict,
              sourceRecordIds,
              completedAt: Math.floor(Date.now() / 1000),
              recommendedGoalCompleted:
                recordSnapshot.isFinished &&
                recordSnapshot.recommendedGoal?.version === 1,
            })
          } catch (error) {
            // Achievement is a sidecar and must never block Learn recovery or
            // daily completion.
            console.error(
              'failed to process Learn block achievement settlement',
              error,
            )
          }
        }

        // The Daily completion snapshot must observe every WordRecord,
        // scheduler/acquisition update and serialized ReviewRecord checkpoint.
        await flushLearnPersistence()

        const stored = loadLearnDailySession(recordSnapshot.dict)
        if (!stored) {
          throw new Error('DailySession checkpoint is missing')
        }

        let dailySession = recordLearnBlockCompletion({
          session: stored,
          blockId: getAchievementSessionId(recordSnapshot),
          activeSeconds,
        })

        const wordRecords = await db.wordRecords
          .where('dict')
          .equals(recordSnapshot.dict)
          .toArray()
        const progress = deriveLearnDailyProgress({
          session: dailySession,
          wordRecords,
        })

        if (progress.complete) {
          dailySession = completeLearnDailySession(
            dailySession,
            Math.floor(Date.now() / 1000),
          )
          await flushLearnPersistence()
        }

        return {
          session: dailySession,
          progress,
        }
      })()
    }

    const settlementPromise = settlementPromiseRef.current

    void settlementPromise
      .then((baseSettlement) => {
        if (active) {
          setSettlement(baseSettlement)
          setSettlementError('')
        }

        if (!baseSettlement.progress.complete) return

        if (!syncPromiseRef.current) {
          syncPromiseRef.current = autoSyncCompletedLearnSession()
        }

        void syncPromiseRef.current
          .then((sync) => {
            if (!active) return
            setSettlement((current) =>
              current
                ? {
                    ...current,
                    sync,
                  }
                : {
                    ...baseSettlement,
                    sync,
                  },
            )
          })
          .catch((error) => {
            // autoSyncCompletedLearnSession normally resolves failures into a
            // typed result, but keep Daily completion non-blocking even if an
            // unexpected caller-level rejection occurs.
            console.error('failed to auto-sync completed Learn session', error)
          })
      })
      .catch((error) => {
        console.error('failed to settle Learn block', error)
        if (active) {
          setSettlementError(
            '阶段状态保存失败，请不要继续操作；刷新页面后系统会从最后一个已保存单词恢复。',
          )
        }
      })

    return () => {
      // Only detach this render's subscriber. The durable operation itself
      // intentionally survives StrictMode effect replay and route-state churn.
      active = false
    }
  }, [record, state.chapterData.wordRecordIds, state.timerData.time])

  const keepLearnSelected = useCallback(() => {
    setReviewModeInfo((old) => ({
      ...old,
      isReviewMode: true,
    }))
  }, [setReviewModeInfo])

  const continueLearn = useCallback(() => {
    if (!settlement || settlement.progress.complete) return

    dispatch({ type: TypingStateActionType.RESET_SESSION })
    keepLearnSelected()
    navigate('/learn', { state: { autoStart: true } })
  }, [
    dispatch,
    keepLearnSelected,
    navigate,
    settlement,
  ])

  const closeResult = useCallback(() => {
    acknowledgeAchievements()
    dispatch({ type: TypingStateActionType.RESET_SESSION })
    keepLearnSelected()
    navigate('/learn', { state: { idle: true } })
  }, [
    acknowledgeAchievements,
    dispatch,
    keepLearnSelected,
    navigate,
  ])

  useEffect(() => {
    if (!settlement || settlement.progress.complete) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' ||
        event.key === 'Shift' ||
        event.key === 'Control' ||
        event.key === 'Alt' ||
        event.key === 'Meta'
      ) {
        return
      }

      event.preventDefault()
      continueLearn()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [continueLearn, settlement])

  useHotkeys(
    'esc',
    () => closeResult(),
    { preventDefault: true },
    [closeResult],
  )

  const progress = settlement?.progress
  const isDailyComplete = progress?.complete === true
  const totalActiveSeconds = settlement
    ? settlement.session.accumulatedActiveSeconds
    : state.timerData.time

  return (
    <div
      className="fixed inset-0 z-30 overflow-y-auto"
      data-learn-result-screen
      data-learn-block-pause={!isDailyComplete || undefined}
      data-learn-daily-complete={isDailyComplete || undefined}
    >
      <div className="absolute inset-0 bg-gray-200/95 backdrop-blur-sm dark:bg-gray-900/90" />
      <div className="relative flex min-h-screen items-center justify-center py-8">
        <div className="my-card relative flex w-[90vw] max-w-3xl flex-col rounded-3xl bg-white px-10 py-10 shadow-lg dark:bg-gray-800">
          <button
            type="button"
            className="absolute right-7 top-5"
            onClick={closeResult}
            aria-label="暂停 Learn"
            title="暂停 Learn 并保留今日进度"
          >
            <IconX className="text-gray-400" />
          </button>

          <div className="text-center">
            <div className="text-sm text-gray-400">
              {currentDictInfo.name} · Learn
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-gray-800 dark:text-gray-100">
              {isDailyComplete ? '今日学习完成' : '阶段完成'}
            </h1>

            {!settlement && !settlementError ? (
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                正在保存本阶段学习状态…
              </p>
            ) : null}

            {settlementError ? (
              <p className="mt-3 text-sm text-red-500" role="alert">
                {settlementError}
              </p>
            ) : null}

            {progress && !isDailyComplete ? (
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                今天已经完成 {progress.percent}%。
                当前状态已保存，按任意键继续下一阶段。
              </p>
            ) : null}

            {progress && isDailyComplete ? (
              <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
                今日计划中的复习和新词已经完成最终独立拼写。
              </p>
            ) : null}
          </div>

          {progress ? (
            <>
              <div className="mx-auto mt-7 h-2 w-full max-w-xl overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                <div
                  className="h-full rounded-full bg-indigo-400 transition-all duration-500"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>

              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <SummaryMetric
                  label="今日进度"
                  value={`${progress.completedWords}/${progress.targetWords}`}
                  detail={`${progress.percent}%`}
                />
                <SummaryMetric
                  label="今日新词"
                  value={`${progress.introducedNewWords}/${settlement?.session.dailyNewTarget ?? 0}`}
                  detail={`独立完成 ${progress.completedNewWords}`}
                />
                <SummaryMetric
                  label="今日复习"
                  value={`${progress.completedReviewWords}/${progress.reviewTargetWords}`}
                  detail="最终独立拼写"
                />
                <SummaryMetric
                  label="待完成"
                  value={progress.remainingWords}
                  detail="词"
                />
                <SummaryMetric
                  label="学习时间"
                  value={formatTime(totalActiveSeconds)}
                />
              </div>
            </>
          ) : null}

          {isDailyComplete && newAchievements.length > 0 ? (
            <section
              className="mt-8 rounded-2xl border border-indigo-100 bg-indigo-50/60 px-6 py-5 text-left dark:border-gray-700 dark:bg-gray-700/60"
              aria-label="今日新成就"
              data-achievement-settlement
            >
              <div className="text-center">
                <div className="text-xs font-medium tracking-[0.18em] text-indigo-400">
                  今日新成就
                </div>
                <div className="mt-1 text-sm text-gray-500 dark:text-gray-300">
                  记录真正发生的能力变化，不奖励机械刷次数。
                </div>
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {newAchievements.map(({ achievement, primary, state: achievementState }) => {
                  const ceremony =
                    resolveAchievementCeremonyPresentation(achievement)
                  const emphasized =
                    ceremony.layout === 'spotlight' ||
                    ceremony.layout === 'ceremony'

                  return (
                    <article
                      key={achievementState.achievementId}
                      className={`rounded-xl bg-white shadow-sm dark:bg-gray-800 ${
                        ceremony.layout === 'compact'
                          ? 'px-4 py-3'
                          : ceremony.layout === 'standard'
                            ? 'px-4 py-4'
                            : ceremony.layout === 'spotlight'
                              ? 'px-6 py-5 sm:col-span-2 ring-1 ring-indigo-200 dark:ring-indigo-500/30'
                              : 'px-6 py-6 sm:col-span-2 ring-2 ring-indigo-300 dark:ring-indigo-400/40'
                      }`}
                    >
                      {emphasized ? (
                        <div className="mb-2 text-xs font-medium tracking-[0.16em] text-indigo-400">
                          {ceremony.label}
                        </div>
                      ) : null}
                      <div className="font-semibold text-gray-800 dark:text-gray-100">
                        <span className="mr-2" aria-hidden="true">
                          {achievement.artDirection.symbol}
                        </span>
                        {achievement.title}
                      </div>
                      <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                        {achievement.copy.unlockMessage}
                      </div>
                      {ceremony.showCulture && primary ? (
                        <div className="mt-3 border-l-2 border-indigo-200 pl-3 text-sm text-gray-600 dark:border-indigo-500/40 dark:text-gray-300">
                          {primary.text}
                        </div>
                      ) : null}
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}

          {isDailyComplete ? (
            <div className="mt-7 text-center text-xs text-gray-400">
              {settlement?.sync
                ? syncText(settlement.sync)
                : '正在检查云同步状态…'}
            </div>
          ) : null}

          <div className="mt-7 flex justify-center">
            {isDailyComplete ? (
              <button
                className="my-btn-primary h-12 px-8 text-base font-bold"
                type="button"
                onClick={closeResult}
              >
                完成
              </button>
            ) : (
              <button
                className="my-btn-primary h-12 px-8 text-base font-bold disabled:bg-gray-300"
                type="button"
                disabled={!settlement || Boolean(settlementError)}
                onClick={continueLearn}
              >
                按任意键继续
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
