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
  const preparationGenerationRef = useRef(0)
  const isActiveRef = useRef(true)

  const { errorWordData } = useErrorWordData(currentDictInfo, false)
  const errorWordDataRef = useRef(errorWordData)
  const { data: wordList } = useSWR(
    currentDictInfo.url,
    wordListFetcher,
  )

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
        const unfinished = await getLatestReviewRecord(dictId)
        if (!isCurrent()) return

        if (unfinished) {
          enterSession(unfinished)
          return
        }

        await bootstrapReviewWordStatesForDictionary(dictId)
        if (!isCurrent()) return

        let record = await generateLearnReviewRecord(
          dictId,
          words,
          errorWordDataRef.current,
          { mode: 'due' },
        )
        if (!isCurrent()) return

        if (!record) {
          record = await generateNewWordAcquisitionRecord(
            dictId,
            words,
          )
        }
        if (!isCurrent()) return

        if (!record) {
          setStatusText('当前词库没有需要学习的单词。')
          setIsStarting(false)
          return
        }

        enterSession(record)
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
