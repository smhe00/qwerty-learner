import ModeSwitcher from '@/components/ModeSwitcher'
import Header from '@/components/Header'
import Layout from '@/components/Layout'
import { buildLearnDailyPlan } from '@/learn/plan'
import { decideDailyAcquisitionQuota } from '@/learn/quota'
import { buildLearnStatsSnapshot } from '@/learn/stats'
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
          const now = Math.floor(Date.now() / 1000)
          const [wordRecords, wordStates] = await Promise.all([
            db.wordRecords.where('dict').equals(dictId).toArray(),
            getReviewWordStates(dictId),
          ])
          if (!isCurrent()) return

          const stats = buildLearnStatsSnapshot({
            now,
            dict: dictId,
            wordRecords,
            wordStates,
            dictionaryWords: words.map((word) => word.name),
          })
          const quota = decideDailyAcquisitionQuota(stats)
          const dailyPlan = buildLearnDailyPlan({ stats, quota })

          if (dailyPlan.allowedNewWordsNow > 0) {
            record = await generateNewWordAcquisitionRecord(
              dictId,
              words,
              dailyPlan.allowedNewWordsNow,
            )
          } else if (stats.lifecycle.unseen === 0) {
            setStatusText('当前词库没有需要学习的单词。')
            setIsStarting(false)
            return
          } else if (dailyPlan.action === 'review-due') {
            setStatusText('还有到期复习需要处理，暂不新增单词。')
            setIsStarting(false)
            return
          } else if (
            dailyPlan.reasonCodes.includes('daily-workload-budget-reached')
          ) {
            setStatusText(
              `今日 Learn 工作量已完成（已投入约 ${dailyPlan.todayActiveMinutes} 分钟）。`,
            )
            setIsStarting(false)
            return
          } else {
            setStatusText(
              `今日新词额度已完成（${stats.today.acquiredWords}/${quota.targetDailyNewWords}）。`,
            )
            setIsStarting(false)
            return
          }
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
