import SessionControl from '@/components/SessionControl'
import FiveMoreButton from './components/FiveMoreButton'
import { useSessionKeyboard } from '@/pages/Typing/hooks/useSessionKeyboard'
import ModeSwitcher from '@/components/ModeSwitcher'
import Header from '@/components/Header'
import Layout from '@/components/Layout'
import { createAsyncOwnershipGuard } from '@/learn/async-ownership'
import { waitForBrowserFuzzGate } from '@/dev/browser-fuzz-hooks'
import { prepareLearnSession } from '@/learn/controller'
import { addLearnDailyNewWords, learnLocalDateKey, loadLearnDailySession } from '@/learn/daily-session'
import { flushLearnPersistence } from '@/learn/persistence'
import { ensureSignedInLearnClock } from '@/sync/learning-clock'
import TypingPage from '@/pages/Typing'
import { DictChapterButton } from '@/pages/Typing/components/DictChapterButton'
import PronunciationSwitcher from '@/pages/Typing/components/PronunciationSwitcher'
import Switcher from '@/pages/Typing/components/Switcher'
import useErrorWordData from '@/pages/Gallery-N/hooks/useErrorWords'
import {
  currentDictIdAtom,
  currentDictInfoAtom,
  memoryConfigAtom,
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

export default function LearnPage({ mobile = false }: { mobile?: boolean } = {}) {
  const navigate = useNavigate()
  const location = useLocation()
  const currentRouteRef = useRef(location.pathname)
  currentRouteRef.current = location.pathname

  const currentDictId = useAtomValue(currentDictIdAtom)
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const memoryConfig = useAtomValue(memoryConfigAtom)
  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)

  const [isSessionView, setIsSessionView] = useState(
    () =>
      reviewModeInfo.isReviewMode &&
      Boolean(reviewModeInfo.reviewRecord) &&
      reviewModeInfo.reviewRecord?.isFinished !== true,
  )
  const [isStarting, setIsStarting] = useState(false)
  const [statusText, setStatusText] = useState('')
  const dailySession = loadLearnDailySession(currentDictId)
  const completedToday = dailySession?.status === 'completed' &&
    dailySession.dateKey === learnLocalDateKey(getUTCUnixTimestamp())
  const exhaustedToday = dailySession?.status === 'active' && dailySession.executionExhausted === true &&
    dailySession.dateKey === learnLocalDateKey(getUTCUnixTimestamp())
  const canLearnMoreToday = completedToday || exhaustedToday
  const userStartRequestedRef = useRef(false)
  const autoStartConsumedRef = useRef(isSessionView)
  const learnPageRootRef = useRef<HTMLElement | null>(null)
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
    // Warm up as soon as Learn opens so the first practice key normally has
    // a calibrated clock already. Auth-free browsers perform no network IO.
    // Promise is shared with explicit startLearn() to avoid duplicate probes.
    void ensureSignedInLearnClock()
    const refresh = window.setInterval(() => {
      void ensureSignedInLearnClock()
    }, 30 * 60 * 1000)
    return () => window.clearInterval(refresh)
  }, [])


  useEffect(() => {
    preparationGuard.activate()

    return () => {
      // StrictMode replays effects while the DOM is still attached. A real
      // route leave disconnects the Learn landing root, so only then revoke
      // preparation ownership.
      if (!learnPageRootRef.current?.isConnected) {
        preparationGuard.deactivate()
      }
    }
  }, [preparationGuard])

  useEffect(() => {
    const routeState = location.state as LearnLocationState | null
    const query = new URLSearchParams(location.search)
    const blockResume = query.get('block-resume') === '1'
    const blockIdle = query.get('block-idle') === '1'

    if (routeState?.autoStart === true || blockResume) {
      // Continue from the result screen without remounting or changing route.
      autoStartConsumedRef.current = false
      setIsSessionView(false)
      setIsStarting(false)
      setStatusText('')
      return
    }

    if (routeState?.idle === true || blockIdle) {
      // Closing a result intentionally leaves Learn idle. Keep that contract
      // across reload until the user explicitly starts again.
      autoStartConsumedRef.current = true
      setIsSessionView(false)
      setIsStarting(false)
      setStatusText('')
    }
  }, [location.key, location.state, location.search])

  useEffect(() => {
    if (isSessionView) return

    setReviewModeInfo((old) =>
      old.isReviewMode
        ? old
        : {
            ...old,
            isReviewMode: true,
          },
    )
  }, [isSessionView, setReviewModeInfo])

  const startLearn = useCallback((addFiveWords = false) => {
    if (!wordList || isStarting || isSessionView) return

    const claim = preparationGuard.begin()
    const dictId = currentDictId
    const words = wordList
    const isCurrent = () =>
      claim.isCurrent() &&
      currentRouteRef.current === (mobile ? '/mobile/study' : '/learn')

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

      // Keep the user on the matching Learn route. Mobile shares this session
      // controller but renders a keyboard-free interaction surface.
      setIsStarting(false)
      setStatusText('')
      autoStartConsumedRef.current = true
      navigate(mobile ? '/mobile/study' : '/learn', { replace: true, state: null })
      setIsSessionView(true)
    }

    const prepare = async () => {
      try {
        await waitForBrowserFuzzGate('learn-preparation')
        // Anchor session creation and FSRS timestamps to a fresh or cached
        // EdgeOne clock observation for authenticated users. Offline study
        // still starts if EdgeOne cannot be reached.
        await ensureSignedInLearnClock()
        if (!isCurrent()) return
        if (addFiveWords) {
          await flushLearnPersistence()
          const [wordRecords, wordStates] = await Promise.all([
            db.wordRecords.where('dict').equals(dictId).toArray(),
            getReviewWordStates(dictId),
          ])
          if (!isCurrent()) return
          const current = loadLearnDailySession(dictId)
          const now = getUTCUnixTimestamp()
          if (current && (current.status === 'completed' || (current.status === 'active' && current.executionExhausted)) && current.dateKey === learnLocalDateKey(now)) {
            const extended = addLearnDailyNewWords({
              session: current, now, dictionaryWords: words.map(word => word.name), wordRecords, wordStates,
            })
            if (extended === current) {
              setStatusText('当前没有可追加的新词。')
              setIsStarting(false)
              return
            }
          }
        }
        const result = await prepareLearnSession({
          dictId,
          words,
          errorEvidence: errorWordDataRef.current,
          dailyNewWordTarget: memoryConfig.dailyNewWordTarget,
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
                { mode: 'due', blockSize: memoryConfig.blockSize },
              ),
            getWordRecords: (id) =>
              db.wordRecords.where('dict').equals(id).toArray(),
            getWordStates: getReviewWordStates,
            generateAcquisition: (id, words, freshLimit) =>
              generateNewWordAcquisitionRecord(id, words, freshLimit, memoryConfig.blockSize),
            generateSession: (id, words, errors, freshLimit) =>
              generateLearnMixedSessionRecord(id, words, errors, freshLimit, memoryConfig.blockSize),
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

        // The finished session was already durably settled. An opt-in V4
        // Block sync was performed from the guarded pre-mount Block card,
        // never from the Learn landing or the legacy V1 auto-upload path.

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
    isSessionView,
    isStarting,
    memoryConfig.dailyNewWordTarget,
    memoryConfig.blockSize,
    navigate,
    preparationGuard,
    setReviewModeInfo,
    wordList,
    mobile,
  ])

  useEffect(() => {
    if (isSessionView) return

    const routeState = location.state as LearnLocationState | null
    const query = new URLSearchParams(location.search)
    // Desktop Learn stays opt-in unless a workflow explicitly requests start.
    // Mobile Learn is intentionally immersive: entering /mobile/study starts
    // the next due/new-word session automatically. Never mutate a restored
    // historical DailySession merely because today's date has advanced.
    const shouldAutoStart =
      mobile || routeState?.autoStart === true || query.get('block-resume') === '1'

    if (
      canLearnMoreToday ||
      !shouldAutoStart ||
      autoStartConsumedRef.current ||
      !wordList
    ) {
      return
    }

    autoStartConsumedRef.current = true
    startLearn()
  }, [
    isSessionView,
    canLearnMoreToday,
    location.state,
    location.search,
    startLearn,
    wordList,
    mobile,
  ])

  const startFromKeyboard = useCallback(() => {
    userStartRequestedRef.current = true
    startLearn()
  }, [startLearn])
  useSessionKeyboard({
    active: false,
    disabled: mobile || isSessionView || isStarting || !wordList || canLearnMoreToday,
    onToggle: startFromKeyboard,
  })

  if (isSessionView) {
    return <TypingPage autoStart={mobile || userStartRequestedRef.current} mobile={mobile} />
  }

  if (mobile) {
    return (
      <main data-mobile-study-start className="mobile-app mobile-study">
        <div className="mobile-study-inner">
          <header className="mobile-study-top">
            <button type="button" className="mobile-back" onClick={() => navigate('/mobile')} aria-label="返回主菜单">‹ 返回</button>
            <span className="mobile-study-context">{currentDictInfo.name}</span>
            <span className="mobile-study-count">Learn</span>
          </header>
          <section className="mobile-today mobile-study-start-card">
            <p className="mobile-eyebrow">TODAY · LEARN</p>
            <h1>{canLearnMoreToday ? '今日目标已完成' : '正在准备学习'}</h1>
            <p className="mobile-today-summary" role={wordListError && !wordList ? 'alert' : 'status'}>
              {isStarting
                ? '正在准备复习与新词…'
                : wordListError && !wordList
                  ? '词库加载失败，请检查网络后重试。'
                  : statusText || (canLearnMoreToday
                    ? '今日计划已完成，可以追加少量新词。'
                    : wordList ? '正在组织复习和新词…' : '正在加载词库…')}
            </p>
            {wordListError && !wordList && (
              <button type="button" className="mobile-practice-primary" onClick={() => void retryWordList()}>
                重新加载词库
              </button>
            )}
            {!isStarting && statusText && wordList && !canLearnMoreToday && (
              <button type="button" className="mobile-practice-primary" onClick={() => startLearn()}>
                重试学习
              </button>
            )}
            {canLearnMoreToday && (
              <button type="button" className="mobile-practice-primary" disabled={isStarting || !wordList} onClick={() => startLearn(true)}>
                再学五词
              </button>
            )}
            <button type="button" className="mobile-start-link" onClick={() => navigate('/mobile')}>
              返回菜单
            </button>
          </section>
        </div>
      </main>
    )
  }

  const renderHeader = () => (
    <Header>
      <div className="focus-toolbar-primary-row" data-toolbar-row="primary">
        <ModeSwitcher />
        {!canLearnMoreToday && <SessionControl active={false} label="开始 Learn"
          disabled={isStarting || !wordList} onToggle={startFromKeyboard} />}
        <DictChapterButton learnMode />
      </div>
      <div className="focus-toolbar-icons-row" data-toolbar-row="icons">
        <PronunciationSwitcher learnMode />
        <Switcher learnMode />
      </div>
    </Header>
  )

  if (wordListError && !wordList) {
    return (
      <Layout>
        {renderHeader()}
        <main
          ref={learnPageRootRef}
          className="container mx-auto flex w-full flex-1 flex-col items-center justify-center gap-4"
        >
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

      <main
        ref={learnPageRootRef}
        className="container mx-auto flex w-full flex-1 flex-col items-center justify-center gap-5"
      >
        <span
          className="text-sm text-gray-400 dark:text-gray-500"
          role="status"
        >
          {isStarting
            ? '正在准备 Learn…'
            : statusText ||
              (exhaustedToday
                ? '本次可执行练习已经结束；未通过最终测试的单词已保留，可再多学五词。'
                : completedToday
                ? '今日 Learn 目标已完成，可以再多学五词。'
                : wordList
                ? '按任意键开始 Learn；Enter 暂停或继续。'
                : '正在加载词表…')}
        </span>

        {canLearnMoreToday && (
          <FiveMoreButton
            disabled={isStarting || !wordList}
            onClick={() => startLearn(true)}
          />
        )}
      </main>
    </Layout>
  )
}
