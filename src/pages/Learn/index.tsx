import ModeSwitcher from '@/components/ModeSwitcher'
import Header from '@/components/Header'
import Layout from '@/components/Layout'
import Tooltip from '@/components/Tooltip'
import { DictChapterButton } from '@/pages/Typing/components/DictChapterButton'
import PronunciationSwitcher from '@/pages/Typing/components/PronunciationSwitcher'
import Switcher from '@/pages/Typing/components/Switcher'
import useErrorWordData from '@/pages/Gallery-N/hooks/useErrorWords'
import {
  currentChapterAtom,
  currentDictIdAtom,
  currentDictInfoAtom,
  reviewModeInfoAtom,
} from '@/store'
import { db } from '@/utils/db'
import { wordListFetcher } from '@/utils/wordListFetcher'
import {
  generateLearnReviewRecord,
  generateNewWordAcquisitionRecord,
  getLatestReviewRecord,
} from '@/utils/db/review-record'
import { bootstrapReviewWordStatesForDictionary } from '@/review/repository'
import { getLearningLifecycle } from '@/learn/lifecycle'
import {
  countUnseenLearningWords,
  decideLearnStartKind,
} from '@/learn/session'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'

export default function LearnPage() {
  const navigate = useNavigate()
  const currentDictId = useAtomValue(currentDictIdAtom)
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const [isStarting, setIsStarting] = useState(false)
  const [statusText, setStatusText] = useState('')

  const { errorWordData } = useErrorWordData(currentDictInfo, false)
  const {
    data: wordList,
    isLoading: isWordListLoading,
  } = useSWR(currentDictInfo.url, wordListFetcher)

  useEffect(() => {
    void bootstrapReviewWordStatesForDictionary(currentDictId)
  }, [currentDictId])

  const states = useLiveQuery(
    () => db.reviewWordStates.where('dict').equals(currentDictId).toArray(),
    [currentDictId],
    [],
  )

  const latestSession = useLiveQuery(
    () => getLatestReviewRecord(currentDictId),
    [currentDictId],
    undefined,
  )

  const activeStates = useMemo(
    () =>
      states.filter(
        (state) => getLearningLifecycle(state) === 'active',
      ),
    [states],
  )

  const now = Math.floor(Date.now() / 1000)
  const dueCount = activeStates.filter(
    (state) => state.nextReviewAt <= now,
  ).length
  const unseenCount = useMemo(
    () =>
      wordList
        ? countUnseenLearningWords(wordList, states)
        : 0,
    [states, wordList],
  )
  const startKind = decideLearnStartKind({ dueCount, unseenCount })

  const enterSession = useCallback(
    (
      record: NonNullable<
        Awaited<ReturnType<typeof generateLearnReviewRecord>>
      >,
    ) => {
      setCurrentChapter(-1)
      setReviewModeInfo({
        isReviewMode: true,
        reviewRecord: record,
      })
      navigate('/learn/session')
    },
    [navigate, setCurrentChapter, setReviewModeInfo],
  )

  const startLearn = useCallback(async () => {
    if (isStarting || !wordList) return
    setIsStarting(true)
    setStatusText('')

    try {
      const unfinished = await getLatestReviewRecord(currentDictId)
      if (unfinished) {
        enterSession(unfinished)
        return
      }

      await bootstrapReviewWordStatesForDictionary(currentDictId)

      let record = await generateLearnReviewRecord(
        currentDictId,
        wordList,
        errorWordData,
        { mode: 'due' },
      )

      if (!record) {
        record = await generateNewWordAcquisitionRecord(
          currentDictId,
          wordList,
        )
      }

      if (!record) {
        setStatusText('当前词库没有需要学习的单词。')
        return
      }

      enterSession(record)
    } finally {
      setIsStarting(false)
    }
  }, [
    currentDictId,
    enterSession,
    errorWordData,
    isStarting,
    wordList,
  ])

  const continueLearn = useCallback(() => {
    if (!latestSession) return
    enterSession(latestSession)
  }, [enterSession, latestSession])

  const primaryDisabled =
    isStarting ||
    (!latestSession &&
      (isWordListLoading || startKind === 'empty'))

  return (
    <Layout>
      <Header>
        <ModeSwitcher />
        <DictChapterButton learnMinimal />
        <div className="invisible pointer-events-none">
          <PronunciationSwitcher />
        </div>
        <Switcher learnMinimal />

        <Tooltip
          content={latestSession ? '继续当前学习' : '开始 Learn'}
          className="box-content h-7 w-8 px-6 py-1"
        >
          <button
            data-header-slot="start"
            className="my-btn-primary w-20 bg-emerald-500 shadow shadow-emerald-300 transition-colors hover:bg-emerald-400 dark:shadow-emerald-500/50"
            type="button"
            disabled={primaryDisabled}
            onClick={() =>
              latestSession
                ? continueLearn()
                : void startLearn()
            }
            aria-label={latestSession ? '继续学习' : '开始'}
          >
            <span className="font-medium">
              {latestSession ? 'Continue' : 'Start'}
            </span>
          </button>
        </Tooltip>
      </Header>

      <main className="container mx-auto flex w-full flex-1 items-start justify-center">
        {statusText && (
          <span
            className="mt-8 text-sm text-gray-400 dark:text-gray-500"
            role="status"
          >
            {statusText}
          </span>
        )}
      </main>
    </Layout>
  )
}
