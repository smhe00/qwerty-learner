import { addLearnDailyNewWords, getLearnExtraRoundNames, loadLearnDailySession } from '@/learn/daily-session'
import { db } from '@/utils/db/core'
import { getReviewWordStates } from '@/review/repository'
import { wordListFetcher } from '@/utils/wordListFetcher'
import {
  getUnseenAchievementStates,
  markAchievementSeen,
} from '@/achievement'
import { resolveAchievementCeremonyPresentation } from '@/achievement/presentation'
import { settleLearnBlockDurably } from '@/learn/settlement'
import type { LearnBlockSettlement } from '@/learn/settlement'
import {
  TypingContext,
  TypingStateActionType,
} from '@/pages/Typing/store'
import { getAchievementCulture } from '@/resources/achievementCulture'
import { currentDictInfoAtom, reviewModeInfoAtom } from '@/store'
import { loadAuth } from '@/sync/auth'
import {
  blockAutoSyncEnabled,
  isVisibleLearnBlockBoundary,
  stageLearnBlockSync,
} from '@/sync/learn-block-sync'
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

export default function LearnResultScreen() {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const navigate = useNavigate()
  const record = reviewModeInfo.reviewRecord
  const [settlement, setSettlement] = useState<LearnBlockSettlement | null>(null)
  const [settlementError, setSettlementError] = useState('')
  const [addingWords, setAddingWords] = useState(false)
  const addingWordsRef = useRef(false)
  const [extraWordsMessage, setExtraWordsMessage] = useState('')
  const [blockSyncHandoff, setBlockSyncHandoff] = useState(false)
  const [blockSyncSetupError, setBlockSyncSetupError] = useState('')
  const blockSyncHandoffRef = useRef(false)
  // React StrictMode replays effects in development. Keep the actual durable
  // settlement in a stable Promise so replayed effects subscribe to the same
  // operation instead of cancelling the only run and leaving Pause disabled.
  const settlementPromiseRef = useRef<Promise<LearnBlockSettlement> | null>(null)
  const skippedInternalBlockRef = useRef(false)

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
      settlementPromiseRef.current = settleLearnBlockDurably({
        record,
        sourceRecordIds: [...state.chapterData.wordRecordIds],
        activeSeconds: state.timerData.time,
      })
    }

    const settlementPromise = settlementPromiseRef.current

    void settlementPromise
      .then((baseSettlement) => {
        if (active) {
          setSettlement(baseSettlement)
          setSettlementError('')
        }

        // Only visible, durable Block boundaries trigger automatic V4 Sync.
        // Navigating destroys this mounted writer context before the guarded
        // S2 executor can capture the complete workspace. Never call V1 auto
        // upload on an opted-in isolated account.
        const auth = loadAuth({ preserveExpired: true })
        const accountId = auth?.user.userId
        const shouldHandoff = Boolean(accountId && auth!.expiresAt * 1000 > Date.now() &&
          (baseSettlement.progress.complete || blockAutoSyncEnabled(accountId)) &&
          isVisibleLearnBlockBoundary({
            dailyComplete: baseSettlement.progress.complete,
            milestone: baseSettlement.milestoneReached,
          }))
        if (active && shouldHandoff && accountId && !blockSyncHandoffRef.current) {
          try {
            stageLearnBlockSync(accountId, {
              dailyComplete: baseSettlement.progress.complete,
              milestone: baseSettlement.milestoneReached,
            })
            blockSyncHandoffRef.current = true
            setBlockSyncHandoff(true)
            // A new document must acquire the S1 writer lock before V4 Sync.
            window.location.replace('/?s2-sync=run&learn-block=1')
          } catch (error) {
            setBlockSyncSetupError(
              '无法启动 Block 自动同步：' +
              (error instanceof Error ? error.message : String(error)) +
              '。本地进度已保存，可稍后手动同步。',
            )
          }
        }
        // Daily completion retains its existing automatic-sync intent via guarded
        // S2 V4. The checkbox only expands that behaviour to each Block.
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
    if (blockSyncHandoffRef.current || blockSyncHandoff || !settlement || settlement.progress.complete) return

    dispatch({ type: TypingStateActionType.RESET_SESSION })
    keepLearnSelected()
    navigate('/learn', { state: { autoStart: true } })
  }, [
    blockSyncHandoff,
    dispatch,
    keepLearnSelected,
    navigate,
    settlement,
  ])

  const learnFiveMore = useCallback(async () => {
    if (blockSyncHandoffRef.current || blockSyncHandoff || !settlement?.progress.complete || addingWordsRef.current) return
    addingWordsRef.current = true
    setAddingWords(true)
    try {
      const [words, wordRecords, wordStates] = await Promise.all([
        wordListFetcher(currentDictInfo.url),
        db.wordRecords.where('dict').equals(settlement.session.dict).toArray(),
        getReviewWordStates(settlement.session.dict),
      ])
      const current = loadLearnDailySession(settlement.session.dict)
      if (!current || current.sessionId !== settlement.session.sessionId) {
        setExtraWordsMessage('今日计划已变化，请重新进入 Learn。')
        return
      }
      const extended = addLearnDailyNewWords({ session: current, now: Math.floor(Date.now() / 1000), dictionaryWords: words.map(word => word.name), wordRecords, wordStates })
      if (extended === current) {
        setExtraWordsMessage('当前没有可追加的新词。')
        return
      }
      acknowledgeAchievements()
      dispatch({ type: TypingStateActionType.RESET_SESSION })
      keepLearnSelected()
      navigate('/learn', { state: { autoStart: true } })
    } catch {
      setExtraWordsMessage('追加新词失败，请重试。')
    } finally {
      addingWordsRef.current = false
      setAddingWords(false)
    }
  }, [blockSyncHandoff, settlement, currentDictInfo.url, acknowledgeAchievements, dispatch, keepLearnSelected, navigate])

  // An internal queue boundary is not a learning-stage achievement. Persist
  // it, then continue seamlessly until a frozen daily milestone is reached.
  useEffect(() => {
    if (!settlement || settlement.progress.complete ||
        !settlement.session.blockMilestones ||
        settlement.milestoneReached !== undefined ||
        skippedInternalBlockRef.current) return
    skippedInternalBlockRef.current = true
    continueLearn()
  }, [settlement, continueLearn])

  const closeResult = useCallback(() => {
    if (blockSyncHandoffRef.current || blockSyncHandoff || !settlement || settlementError) return
    acknowledgeAchievements()
    dispatch({ type: TypingStateActionType.RESET_SESSION })
    keepLearnSelected()
    navigate('/learn', { state: { idle: true } })
  }, [
    acknowledgeAchievements,
    blockSyncHandoff,
    dispatch,
    keepLearnSelected,
    navigate,
    settlement,
    settlementError,
  ])

  useEffect(() => {
    if (!settlement || settlement.progress.complete || blockSyncHandoffRef.current || blockSyncHandoff) return

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
  }, [blockSyncHandoff, continueLearn, settlement])

  useHotkeys(
    'esc',
    () => closeResult(),
    { preventDefault: true },
    [closeResult],
  )

  const progress = settlement?.progress
  const milestoneIndex = settlement?.milestoneReached === undefined
    ? -1
    : (settlement.session.blockMilestones ?? []).indexOf(settlement.milestoneReached)
  const isExtraRound = !!getLearnExtraRoundNames(settlement?.session ?? null)
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
            className="absolute right-7 top-5 disabled:cursor-not-allowed disabled:opacity-30"
            onClick={closeResult}
            disabled={blockSyncHandoff || !settlement || Boolean(settlementError)}
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
              {isDailyComplete ? getLearnExtraRoundNames(settlement?.session ?? null) ? '本次加学完成' : '今日学习完成' : milestoneIndex >= 0
                ? `阶段 ${milestoneIndex + 1} 完成`
                : settlement?.session.blockMilestones ? '继续学习' : '阶段完成'}
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
            {blockSyncHandoff ? (
              <p className="mt-3 text-sm text-indigo-500" role="status"
                data-learn-block-sync-pending>
                正在进入安全同步；同步完成后才能继续或退出…
              </p>
            ) : null}
            {blockSyncSetupError ? (
              <p className="mt-3 text-sm text-amber-600" role="alert">
                {blockSyncSetupError}
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
                {getLearnExtraRoundNames(settlement?.session ?? null) ? '本轮追加的新词已完成，其他未掌握词已保留。' : '今日计划中的复习和新词已经完成最终独立拼写。'}
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
                  label={isExtraRound ? '本轮进度' : '今日进度'}
                  value={`${progress.completedWords}/${progress.targetWords}`}
                  detail={`${progress.percent}%`}
                />
                <SummaryMetric
                  label={isExtraRound ? '本轮新词' : '今日新词'}
                  value={`${progress.introducedNewWords}/${progress.newTargetWords}`}
                  detail={`独立完成 ${progress.completedNewWords}`}
                />
                <SummaryMetric
                  label={isExtraRound ? '本轮复习' : '今日复习'}
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
              本地进度已保存；如云端同步未执行，可在设置中手动同步。
            </div>
          ) : null}

          {extraWordsMessage ? <p className="mt-4 text-center text-sm text-gray-500" role="status">{extraWordsMessage}</p> : null}
          <div className="mt-7 flex justify-center gap-4">
            {isDailyComplete ? <button className="my-btn h-12 px-8 text-base disabled:opacity-50" type="button" disabled={addingWords || blockSyncHandoff} onClick={() => void learnFiveMore()}>多学五词</button> : null}
            {isDailyComplete ? (
              <button
                className="my-btn-primary h-12 px-8 text-base font-bold disabled:opacity-40"
                type="button"
                disabled={blockSyncHandoff || !settlement || Boolean(settlementError)}
                onClick={closeResult}
              >
                完成
              </button>
            ) : (
              <button
                className="my-btn-primary h-12 px-8 text-base font-bold disabled:bg-gray-300"
                type="button"
                disabled={!settlement || Boolean(settlementError) || blockSyncHandoff}
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
