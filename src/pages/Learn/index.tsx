import ModeSwitcher from '@/components/ModeSwitcher'
import Header from '@/components/Header'
import Layout from '@/components/Layout'
import { Button } from '@/components/ui/button'
import useErrorWordData from '@/pages/Gallery-N/hooks/useErrorWords'
import Setting from '@/pages/Typing/components/Setting'
import { dictionaries } from '@/resources/dictionary'
import {
  currentChapterAtom,
  currentDictIdAtom,
  currentDictInfoAtom,
  reviewModeInfoAtom,
} from '@/store'
import { db } from '@/utils/db'
import {
  generateNewWordReviewRecord,
  getLatestReviewRecord,
} from '@/utils/db/review-record'
import {
  bootstrapReviewWordStatesForDictionary,
  excludeLearningWord,
  restoreLearningWord,
} from '@/review/repository'
import { getLearningLifecycle } from '@/learn/lifecycle'
import { useLiveQuery } from 'dexie-react-hooks'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

type PlanTab = 'active' | 'excluded'

export default function LearnPage() {
  const navigate = useNavigate()
  const [currentDictId, setCurrentDictId] = useAtom(currentDictIdAtom)
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const [tab, setTab] = useState<PlanTab>('active')
  const [isStarting, setIsStarting] = useState(false)
  const [statusText, setStatusText] = useState('')

  const { errorWordData } = useErrorWordData(currentDictInfo, false)

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
  const unseenCount = Math.max(
    0,
    currentDictInfo.length - activeStates.length - excludedStates.length,
  )

  const enterSession = useCallback(
    (record: NonNullable<Awaited<ReturnType<typeof generateNewWordReviewRecord>>>) => {
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
      if (isStarting) return
      setIsStarting(true)
      setStatusText('')
      try {
        await bootstrapReviewWordStatesForDictionary(currentDictId)
        const record = await generateNewWordReviewRecord(
          currentDictId,
          errorWordData,
          { mode },
        )
        if (!record) {
          setStatusText(
            mode === 'due'
              ? '今天没有到期的长期学习词。'
              : '当前没有可用于额外学习的长期学习词。',
          )
          return
        }
        enterSession(record)
      } finally {
        setIsStarting(false)
      }
    },
    [currentDictId, enterSession, errorWordData, isStarting],
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
        <select
          aria-label="Learn 词库"
          value={currentDictId}
          onChange={(event) => {
            setCurrentDictId(event.target.value)
            setCurrentChapter(0)
            setStatusText('')
          }}
          className="rounded-lg bg-transparent px-3 py-1.5 text-sm text-gray-700 outline-none hover:bg-indigo-50 dark:text-gray-200 dark:hover:bg-gray-700"
        >
          {dictionaries.map((dict) => (
            <option key={dict.id} value={dict.id}>
              {dict.name}
            </option>
          ))}
        </select>
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
            当前 A/B 阶段已接管原有长期复习状态，新词的全量 admission
            会在后续阶段开启。
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
          {latestSession && (
            <Button onClick={continueLearn}>继续当前学习</Button>
          )}
          <Button
            disabled={isStarting || dueCount === 0}
            onClick={() => void startLearn('due')}
          >
            开始今日学习
          </Button>
          <Button
            variant="outline"
            disabled={isStarting || activeStates.length === 0}
            onClick={() => void startLearn('force')}
          >
            额外复习
          </Button>
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
