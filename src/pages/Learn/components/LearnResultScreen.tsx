import { TypingContext } from '@/pages/Typing/store'
import {
  currentDictInfoAtom,
  reviewModeInfoAtom,
} from '@/store'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useContext, useMemo } from 'react'
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

  const record = reviewModeInfo.reviewRecord
  const isAcquisition = record?.sessionKind === 'acquisition'

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
    leaveLearn()
    navigate('/learn')
  }, [leaveLearn, navigate])

  const chooseDictionary = useCallback(() => {
    leaveLearn()
    navigate('/gallery?mode=learn')
  }, [leaveLearn, navigate])

  const returnToTyping = useCallback(() => {
    leaveLearn()
    navigate('/typing')
  }, [leaveLearn, navigate])

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
      <div className="relative flex h-screen items-center justify-center">
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
