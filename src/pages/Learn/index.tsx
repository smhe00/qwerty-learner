import ModeSwitcher from '@/components/ModeSwitcher'
import Header from '@/components/Header'
import Layout from '@/components/Layout'
import { DictChapterButton } from '@/pages/Typing/components/DictChapterButton'
import PronunciationSwitcher from '@/pages/Typing/components/PronunciationSwitcher'
import Switcher from '@/pages/Typing/components/Switcher'
import useErrorWordData from '@/pages/Gallery-N/hooks/useErrorWords'
import {
  currentDictIdAtom,
  currentDictInfoAtom,
  reviewModeInfoAtom,
} from '@/store'
import { wordListFetcher } from '@/utils/wordListFetcher'
import {
  generateLearnReviewRecord,
  generateNewWordAcquisitionRecord,
  getLatestReviewRecord,
} from '@/utils/db/review-record'
import { bootstrapReviewWordStatesForDictionary } from '@/review/repository'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'

export default function LearnPage() {
  const navigate = useNavigate()
  const currentDictId = useAtomValue(currentDictIdAtom)
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const [isStarting, setIsStarting] = useState(true)
  const [statusText, setStatusText] = useState('')
  const startInFlightRef = useRef(false)
  const attemptedDictRef = useRef<string | null>(null)
  const isActiveRef = useRef(true)

  const { errorWordData } = useErrorWordData(currentDictInfo, false)
  const { data: wordList } = useSWR(
    currentDictInfo.url,
    wordListFetcher,
  )

  const enterSession = useCallback(
    (
      record: NonNullable<
        Awaited<ReturnType<typeof generateLearnReviewRecord>>
      >,
    ) => {
      if (!isActiveRef.current) return

      setReviewModeInfo({
        isReviewMode: true,
        reviewRecord: record,
      })
      navigate('/learn/session')
    },
    [navigate, setReviewModeInfo],
  )

  const prepareLearnSession = useCallback(async () => {
    if (startInFlightRef.current || !wordList) return

    startInFlightRef.current = true
    setIsStarting(true)
    setStatusText('')
    let enteredSession = false

    try {
      const unfinished = await getLatestReviewRecord(currentDictId)
      if (unfinished) {
        enteredSession = true
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
        if (isActiveRef.current) {
          setStatusText('当前词库没有需要学习的单词。')
        }
        return
      }

      enteredSession = true
      enterSession(record)
    } catch {
      if (isActiveRef.current) {
        setStatusText('Learn 准备失败，请重试。')
      }
    } finally {
      startInFlightRef.current = false
      if (isActiveRef.current && !enteredSession) {
        setIsStarting(false)
      }
    }
  }, [
    currentDictId,
    enterSession,
    errorWordData,
    wordList,
  ])

  useEffect(() => {
    isActiveRef.current = true
    return () => {
      isActiveRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!wordList || attemptedDictRef.current === currentDictId) return

    attemptedDictRef.current = currentDictId
    void prepareLearnSession()
  }, [currentDictId, prepareLearnSession, wordList])

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
