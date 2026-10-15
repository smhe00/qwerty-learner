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

export default function LearnPage() {
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
      currentRouteRef.current === '/learn'

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

      // /learn is the only Learn route. Switching from preparation to the
      // spelling engine is a local state transition, not navigation.
      setIsStarting(false)
      setStatusText('')
      autoStartConsumedRef.current = true
      navigate('/learn', { replace: true, state: null })
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
  ])

  useEffect(() => {
    if (isSessionView) return

    const routeState = location.state as LearnLocationState | null
    const query = new URLSearchParams(location.search)
    // Mounting the Learn landing page must be read-only. In particular, an S2
    // cloud Pull or portable V4 import must not silently replace a restored
    // historical DailySession simply because today's date has advanced.
    // Only an explicit workflow continuation may auto-start; otherwise the
    // user's first keypress/Start action starts preparation.
    const shouldAutoStart =
      routeState?.autoStart === true || query.get('block-resume') === '1'

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
  ])

  const startFromKeyboard = useCallback(() => {
    userStartRequestedRef.current = true
    startLearn()
  }, [startLearn])
  useSessionKeyboard({
    active: false,
    disabled: isSessionView || isStarting || !wordList || canLearnMoreToday,
    onToggle: startFromKeyboard,
  })

  if (isSessionView) {
    return <TypingPage autoStart={userStartRequestedRef.current} />
  }

  const renderHeader = () => (
    <Header>
      <ModeSwitcher />
      {!canLearnMoreToday && <SessionControl active={false} label="开始 Learn"
        disabled={isStarting || !wordList} onToggle={startFromKeyboard} />}
      <DictChapterButton learnMode />
      <PronunciationSwitcher learnMode />
      <Switcher learnMode />
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
