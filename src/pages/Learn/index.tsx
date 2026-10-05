import ModeSwitcher from '@/components/ModeSwitcher'
import Header from '@/components/Header'
import Layout from '@/components/Layout'
import { createAsyncOwnershipGuard } from '@/learn/async-ownership'
import { prepareLearnSession } from '@/learn/controller'
import { DictChapterButton } from '@/pages/Typing/components/DictChapterButton'
import PronunciationSwitcher from '@/pages/Typing/components/PronunciationSwitcher'
import Switcher from '@/pages/Typing/components/Switcher'
import useErrorWordData from '@/pages/Gallery-N/hooks/useErrorWords'
import {
  currentDictIdAtom,
  currentDictInfoAtom,
  reviewModeInfoAtom,
} from '@/store'
import { getUTCUnixTimestamp } from '@/utils'
import { wordListFetcher } from '@/utils/wordListFetcher'
import {
  generateLearnMixedSessionRecord,
  generateLearnReviewRecord,
  generateNewWordAcquisitionRecord,
  getLatestReviewRecord,
  getNextDeferredAcquisitionResumeAt,
} from '@/utils/db/review-record'
import {
  bootstrapReviewWordStatesForDictionary,
  getReviewWordStates,
} from '@/review/repository'
import { db } from '@/utils/db'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import useSWR from 'swr'

type LearnLocationState = {
  autoStart?: boolean
  idle?: boolean
}

export default function LearnPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const currentDictId = useAtomValue(currentDictIdAtom)
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const [isStarting, setIsStarting] = useState(false)
  const [statusText, setStatusText] = useState('')
  const autoStartConsumedRef = useRef(false)
  const lifecycleEpochRef = useRef(0)
  const preparationGuardRef = useRef<
    ReturnType<typeof createAsyncOwnershipGuard> | null
  >(null)
  if (preparationGuardRef.current === null) {
    preparationGuardRef.current = createAsyncOwnershipGuard()
  }
  const preparationGuard = preparationGuardRef.current

  const { errorWordData } = useErrorWordData(currentDictInfo, false)
  const errorWordDataRef = useRef(errorWordData)
  const {
    data: wordList,
    error: wordListError,
    mutate: retryWordList,
  } = useSWR(currentDictInfo.url, wordListFetcher)

  useEffect(() => {
    errorWordDataRef.current = errorWordData
  }, [errorWordData])

  useEffect(() => {
    const lifecycleEpoch = lifecycleEpochRef.current + 1
    lifecycleEpochRef.current = lifecycleEpoch
    preparationGuard.activate()

    return () => {
      // React StrictMode replays mount effects in development. Deferring the
      // cleanup by one microtask lets the immediately following replay claim a
      // newer lifecycle epoch, while a real unmount still invalidates pending
      // Learn preparation before its async work can commit.
      queueMicrotask(() => {
        if (lifecycleEpochRef.current === lifecycleEpoch) {
          preparationGuard.deactivate()
        }
      })
    }
  }, [preparationGuard])

  useEffect(() => {
    setReviewModeInfo((old) =>
      old.isReviewMode
        ? old
        : {
            ...old,
            isReviewMode: true,
          },
    )
  }, [setReviewModeInfo])

  const startLearn = useCallback(() => {
    if (!wordList || isStarting) return

    const claim = preparationGuard.begin()
    const dictId = currentDictId
    const words = wordList
    const isCurrent = claim.isCurrent

    setIsStarting(true)
    setStatusText('')

    const enterSession = (
      record: NonNullable<
        Awaited<ReturnType<typeof generateLearnReviewRecord>>
      >,
    ) => {
      if (!isCurrent()) return

      setReviewModeInfo({
        isReviewMode: true,
        reviewRecord: record,
      })
      navigate('/learn/session')
    }

    const prepare = async () => {
      try {
        const result = await prepareLearnSession({
          dictId,
          words,
          errorEvidence: errorWordDataRef.current,
          dependencies: {
            now: getUTCUnixTimestamp,
            bootstrap: async (id, now) => {
              await bootstrapReviewWordStatesForDictionary(id, now)
            },
            getLatestSession: getLatestReviewRecord,
            generateDueReview: async (id, sessionWords, errorEvidence) =>
              generateLearnReviewRecord(
                id,
                sessionWords,
                errorEvidence,
                { mode: 'due' },
              ),
            getWordRecords: (id) =>
              db.wordRecords.where('dict').equals(id).toArray(),
            getWordStates: getReviewWordStates,
            generateAcquisition: generateNewWordAcquisitionRecord,
            generateSession: generateLearnMixedSessionRecord,
            getNextDeferredResumeAt:
              getNextDeferredAcquisitionResumeAt,
          },
        })
        if (!isCurrent()) return

        if (result.kind === 'session') {
          enterSession(result.record)
          return
        }

        setStatusText(result.statusText)
        setIsStarting(false)
      } catch {
        if (isCurrent()) {
          setStatusText('Learn 准备失败，请重试。')
          setIsStarting(false)
        }
      }
    }

    void prepare()
  }, [
    currentDictId,
    isStarting,
    navigate,
    preparationGuard,
    setReviewModeInfo,
    wordList,
  ])

  useEffect(() => {
    const routeState = location.state as LearnLocationState | null
    const shouldAutoStart =
      routeState?.autoStart === true || routeState?.idle !== true

    if (
      !shouldAutoStart ||
      autoStartConsumedRef.current ||
      !wordList
    ) {
      return
    }

    autoStartConsumedRef.current = true
    navigate('/learn', { replace: true, state: null })
    startLearn()
  }, [location.state, navigate, startLearn, wordList])

  const renderHeader = () => (
    <Header>
      <ModeSwitcher />
      <DictChapterButton learnMode />
      <PronunciationSwitcher learnMode />
      <Switcher learnMode />
    </Header>
  )

  if (wordListError && !wordList) {
    return (
      <Layout>
        {renderHeader()}
        <main className="container mx-auto flex w-full flex-1 flex-col items-center justify-center gap-4">
          <span
            className="text-sm text-gray-500 dark:text-gray-400"
            role="alert"
          >
            词表加载失败，系统会自动重试。
          </span>
          <button
            type="button"
            className="my-btn-primary bg-indigo-500 text-sm"
            onClick={() => void retryWordList()}
          >
            立即重试
          </button>
        </main>
      </Layout>
    )
  }

  return (
    <Layout>
      {renderHeader()}

      <main className="container mx-auto flex w-full flex-1 flex-col items-center justify-center gap-5">
        <span
          className="text-sm text-gray-400 dark:text-gray-500"
          role="status"
        >
          {isStarting
            ? '正在准备 Learn…'
            : statusText ||
              (wordList
                ? 'Learn 已就绪。可以随时开始，也可以在学习过程中随时暂停。'
                : '正在加载词表…')}
        </span>

        <button
          type="button"
          className="my-btn-primary w-24 bg-indigo-500 shadow shadow-indigo-300 dark:shadow-indigo-500/60"
          onClick={startLearn}
          disabled={isStarting || !wordList}
          aria-label="开始 Learn"
        >
          <span className="font-medium">Start</span>
        </button>
      </main>
    </Layout>
  )
}
