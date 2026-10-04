import ModeSwitcher from '@/components/ModeSwitcher'
import Header from '@/components/Header'
import Layout from '@/components/Layout'
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
  generateLearnReviewRecord,
  generateNewWordAcquisitionRecord,
  getLatestReviewRecord,
  getNextSpacingDeferredResumeAt,
} from '@/utils/db/review-record'
import {
  bootstrapReviewWordStatesForDictionary,
  getReviewWordStates,
} from '@/review/repository'
import { db } from '@/utils/db'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'

export default function LearnPage() {
  const navigate = useNavigate()
  const currentDictId = useAtomValue(currentDictIdAtom)
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const [isStarting, setIsStarting] = useState(true)
  const [statusText, setStatusText] = useState('')
  const preparationGenerationRef = useRef(0)
  const isActiveRef = useRef(true)

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
    isActiveRef.current = true
    return () => {
      isActiveRef.current = false
      preparationGenerationRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (!wordList) return

    const generation = preparationGenerationRef.current + 1
    preparationGenerationRef.current = generation
    const dictId = currentDictId
    const words = wordList

    const isCurrent = () =>
      isActiveRef.current &&
      preparationGenerationRef.current === generation

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
            getNextSpacingResumeAt: getNextSpacingDeferredResumeAt,
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

    return () => {
      if (preparationGenerationRef.current === generation) {
        preparationGenerationRef.current += 1
      }
    }
  }, [currentDictId, navigate, setReviewModeInfo, wordList])

  if (wordListError && !wordList) {
    return (
      <Layout>
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

  if (isStarting || !wordList) {
    return (
      <Layout>
        <main className="container mx-auto flex w-full flex-1 items-start justify-center">
          <span
            className="mt-8 text-sm text-gray-400 dark:text-gray-500"
            role="status"
          >
            正在准备 Learn…
          </span>
        </main>
      </Layout>
    )
  }

  return (
    <Layout>
      <Header>
        <ModeSwitcher />
        <DictChapterButton learnMode />
        <PronunciationSwitcher learnMode />
        <Switcher learnMode />
      </Header>

      <main className="container mx-auto flex w-full flex-1 items-start justify-center">
        <span
          className="mt-8 text-sm text-gray-400 dark:text-gray-500"
          role="status"
        >
          {statusText}
        </span>
      </main>
    </Layout>
  )
}
