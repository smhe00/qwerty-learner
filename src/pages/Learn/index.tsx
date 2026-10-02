import ModeSwitcher from '@/components/ModeSwitcher'
import Header from '@/components/Header'
import Layout from '@/components/Layout'
import Tooltip from '@/components/Tooltip'
import { Button } from '@/components/ui/button'
import useErrorWordData from '@/pages/Gallery-N/hooks/useErrorWords'
import Setting from '@/pages/Typing/components/Setting'
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
import {
  bootstrapReviewWordStatesForDictionary,
  excludeLearningWord,
  restoreLearningWord,
} from '@/review/repository'
import { getLearningLifecycle } from '@/learn/lifecycle'
import {
  countUnseenLearningWords,
  decideLearnStartKind,
} from '@/learn/session'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import useSWR from 'swr'

type PlanTab = 'active' | 'excluded'

export default function LearnPage() {
  const navigate = useNavigate()
  const currentDictId = useAtomValue(currentDictIdAtom)
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const [tab, setTab] = useState<PlanTab>('active')
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
      states
        .filter((state) => getLearningLifecycle(state) === 'active')
        .sort((left, right) => left.word.localeCompare(right.word)),
    [states],
  )
  const excludedStates = useMemo(
    () =>
      states
        .filter((state) => getLearningLifecycle(state) === 'excluded')
        .sort((left, right) => left.word.localeCompare(right.word)),
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
    (record: NonNullable<Awaited<ReturnType<typeof generateLearnReviewRecord>>>) => {
      setCurrentChapter(-1)
      setReviewModeInfo({
        isReviewMode: true,
        reviewRecord: record,
      })
      navigate('/learn/session')
    },
    [navigate, setCurrentChapter, setReviewModeInfo],
  )

  const startLearn = useCallback(
    async (mode: 'due' | 'force') => {
      if (isStarting || !wordList) return
      setIsStarting(true)
      setStatusText('')
      try {
        // A Learn plan owns at most one unfinished session per dictionary.
        // Re-read IndexedDB here instead of trusting only the live-query UI so
        // a render/load race cannot create a second unfinished session.
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
          { mode },
        )

        // Normal Learn always prioritizes due long-term reviews. Only when
        // there is no due card do we open a bounded new-word acquisition
        // session. Extra review remains review-only.
        if (!record && mode === 'due') {
          record = await generateNewWordAcquisitionRecord(
            currentDictId,
            wordList,
          )
        }

        if (!record) {
          setStatusText(
            mode === 'due'
              ? '当前词库没有需要复习或新学习的单词。'
              : '当前没有可用于额外复习的长期学习词。',
          )
          return
        }

        enterSession(record)
      } finally {
        setIsStarting(false)
      }
    },
    [
      currentDictId,
      enterSession,
      errorWordData,
      isStarting,
      wordList,
    ],
  )

  const continueLearn = useCallback(() => {
    if (!latestSession) return
    setCurrentChapter(-1)
    setReviewModeInfo({
      isReviewMode: true,
      reviewRecord: latestSession,
    })
    navigate('/learn/session')
  }, [latestSession, navigate, setCurrentChapter, setReviewModeInfo])

  const excludeWord = useCallback(
    async (word: string) => {
      await excludeLearningWord(currentDictId, word)
    },
    [currentDictId],
  )

  const restoreWord = useCallback(
    async (word: string) => {
      await restoreLearningWord(currentDictId, word)
    },
    [currentDictId],
  )

  const visibleStates = tab === 'active' ? activeStates : excludedStates

  return (
    <Layout>
      <Header>
        <ModeSwitcher />
        <Tooltip content="词典切换">
          <NavLink
            className="block rounded-lg px-3 py-1 text-lg transition-colors duration-300 ease-in-out hover:bg-indigo-400 hover:text-white focus:outline-none dark:text-white dark:text-opacity-60 dark:hover:text-opacity-100"
            to="/gallery?mode=learn"
          >
            {currentDictInfo.name}
          </NavLink>
        </Tooltip>
        <Setting />
      </Header>

      <main className="container mx-auto flex w-full max-w-5xl flex-1 flex-col px-8 pb-12 pt-8">
        <div className="mb-8">
          <div className="text-sm font-medium text-indigo-500">Learn</div>
          <h2 className="mt-1 text-3xl font-semibold text-gray-800 dark:text-gray-100">
            {currentDictInfo.name}
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
            Learn 管理长期记忆；Typing 保持原项目的章节打字练习逻辑。
            Learn 优先处理到期长期复习；如果当前没有到期词，则自动进入新词学习。
          </p>
        </div>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[
            ['今日到期', dueCount],
            ['长期学习中', activeStates.length],
            ['尚未进入 Learn', unseenCount],
            ['已移出', excludedStates.length],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800"
            >
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {label}
              </div>
              <div className="mt-2 text-3xl font-semibold text-gray-800 dark:text-gray-100">
                {value}
              </div>
            </div>
          ))}
        </section>

        <section className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {latestSession ? (
            <Button onClick={continueLearn}>继续当前学习</Button>
          ) : (
            <>
              <Button
                disabled={
                  isStarting ||
                  isWordListLoading ||
                  startKind === 'empty'
                }
                onClick={() => void startLearn('due')}
              >
                开始学习
              </Button>
              <Button
                variant="outline"
                disabled={isStarting || activeStates.length === 0}
                onClick={() => void startLearn('force')}
              >
                额外复习
              </Button>
            </>
          )}
          {statusText && (
            <span className="text-sm text-gray-500" role="status">
              {statusText}
            </span>
          )}
        </section>

        <section className="mt-8 min-h-0 flex-1 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                学习计划
              </h3>
              <p className="mt-1 text-xs text-gray-500">
                “移出学习计划”只停止 Learn 调度，不删除历史记录，也不代表算法判定为 mastered。
              </p>
            </div>
            <div className="flex rounded-lg bg-gray-100 p-1 text-sm dark:bg-gray-700">
              <button
                type="button"
                className={`rounded-md px-3 py-1 ${
                  tab === 'active'
                    ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800'
                    : 'text-gray-500'
                }`}
                onClick={() => setTab('active')}
              >
                学习中 {activeStates.length}
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1 ${
                  tab === 'excluded'
                    ? 'bg-white text-indigo-600 shadow-sm dark:bg-gray-800'
                    : 'text-gray-500'
                }`}
                onClick={() => setTab('excluded')}
              >
                已移出 {excludedStates.length}
              </button>
            </div>
          </div>

          <div className="max-h-[26rem] overflow-y-auto">
            {visibleStates.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">
                {tab === 'active'
                  ? '当前还没有长期学习状态。'
                  : '当前没有已移出的单词。'}
              </div>
            ) : (
              <div className="divide-y divide-gray-100 dark:divide-gray-700">
                {visibleStates.map((state) => (
                  <div
                    key={state.word}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div>
                      <div className="font-medium text-gray-800 dark:text-gray-100">
                        {state.word}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-400">
                        {tab === 'active'
                          ? state.nextReviewAt <= now
                            ? '已到期'
                            : '已安排后续复习'
                          : '不会进入 Learn 队列'}
                      </div>
                    </div>
                    {tab === 'active' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void excludeWord(state.word)}
                      >
                        移出学习计划
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void restoreWord(state.word)}
                      >
                        恢复学习
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </Layout>
  )
}
