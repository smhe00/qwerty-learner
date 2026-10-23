import { isLearnSessionOutsideExtraRound } from '@/learn/daily-session'
import Layout from '../../components/Layout'
import ModeSwitcher from '@/components/ModeSwitcher'
import { DictChapterButton } from './components/DictChapterButton'
import PronunciationSwitcher from './components/PronunciationSwitcher'
import ResultScreen from './components/ResultScreen'
import Speed from './components/Speed'
import SessionButton from './components/StartButton'
import { useSessionKeyboard } from './hooks/useSessionKeyboard'
import Switcher from './components/Switcher'
import WordList from './components/WordList'
import WordPanel from './components/WordPanel'
import { useConfetti } from './hooks/useConfetti'
import { useWordList } from './hooks/useWordList'
import { appendDeveloperTrace } from '@/dev/diagnostic-trace'
import {
  ensureLearnDailySession,
  loadLearnDailySession,
} from '@/learn/daily-session'
import {
  shouldRotateOversizedLearnSession,
} from '@/learn/session'
import { TypingContext, TypingStateActionType, initialState, typingReducer } from './store'
import { DonateCard } from '@/components/DonateCard'
import LearnLiveStats from '@/pages/Learn/components/LearnLiveStats'
import LearnResultScreen from '@/pages/Learn/components/LearnResultScreen'
import MobileResult from '@/pages/Mobile/MobileResult'
import { useMobileVisualViewport } from '@/pages/Mobile/useMobileVisualViewport'
import Header from '@/components/Header'
import Tooltip from '@/components/Tooltip'
import { DEFAULT_DICTIONARY_ID } from '@/resources/defaultDictionary'
import { idDictionaryMap } from '@/resources/dictionary'
import {
  currentChapterAtom,
  currentDictIdAtom,
  isReviewModeAtom,
  memoryConfigAtom,
  randomConfigAtom,
  reviewModeInfoAtom,
  typingTransVisibleAtom,
} from '@/store'
import { flushLearnPersistence } from '@/learn/persistence'
import { ArrowLeft, Pause, Play } from 'lucide-react'
import { Dialog } from '@headlessui/react'
import { getReviewWordStates } from '@/review/repository'
import { db, useSaveChapterRecord } from '@/utils/db'
import { getUTCUnixTimestamp } from '@/utils/time'
import { putWordReviewRecord } from '@/utils/db/review-record'
import { wordListFetcher } from '@/utils/wordListFetcher'
import { useMixPanelChapterLogUploader } from '@/utils/mixpanel'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { useImmerReducer } from 'use-immer'

const App: React.FC<{ autoStart?: boolean; mobile?: boolean }> = ({ autoStart = false, mobile = false }) => {
  const autoStartPendingRef = useRef(autoStart)
  const mobileShellRef = useRef<HTMLDivElement>(null)
  const typingTransVisible = useAtomValue(typingTransVisibleAtom)
  const [state, dispatch] = useImmerReducer(typingReducer, {
    ...structuredClone(initialState),
    isTransVisible: typingTransVisible,
  })
  useMobileVisualViewport(mobile && !state.isFinished, mobileShellRef)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const { words } = useWordList()
  const navigate = useNavigate()
  const location = useLocation()
  const setupIdentityRef = useRef<string | null>(null)
  const legacyRotationRef = useRef<string | null>(null)

  const [currentDictId, setCurrentDictId] = useAtom(currentDictIdAtom)
  const currentChapter = useAtomValue(currentChapterAtom)
  const setCurrentChapter = useSetAtom(currentChapterAtom)
  const randomConfig = useAtomValue(randomConfigAtom)
  const memoryConfig = useAtomValue(memoryConfigAtom)
  const chapterLogUploader = useMixPanelChapterLogUploader(state)
  const saveChapterRecord = useSaveChapterRecord()

  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const isLearnSurface =
    isReviewMode || location.pathname.startsWith('/learn')

  useEffect(() => {
    const record = reviewModeInfo.reviewRecord
    if (
      !isReviewMode ||
      !record ||
      record.isFinished ||
      loadLearnDailySession(record.dict)
    ) {
      return
    }

    let cancelled = false

    const migrateActiveBlock = async () => {
      try {
        const dictInfo = idDictionaryMap[record.dict]
        const [wordRecords, wordStates, dictionaryWords] =
          await Promise.all([
            db.wordRecords.where('dict').equals(record.dict).toArray(),
            getReviewWordStates(record.dict),
            dictInfo
              ? wordListFetcher(dictInfo.url)
              : Promise.resolve(record.words),
          ])

        if (cancelled) return

        ensureLearnDailySession({
          dict: record.dict,
          now: getUTCUnixTimestamp(),
          dailyNewTarget: memoryConfig.dailyNewWordTarget,
          dictionaryWords: dictionaryWords.map((word) => word.name),
          wordRecords,
          wordStates,
        })
      } catch (error) {
        console.error(
          'failed to anchor active Learn block to DailySession',
          error,
        )
      }
    }

    void migrateActiveBlock()
    return () => {
      cancelled = true
    }
  }, [
    isReviewMode,
    memoryConfig.dailyNewWordTarget,
    reviewModeInfo.reviewRecord,
  ])

  useEffect(() => {
    if (!mobile) return
    return () => {
      dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: false })
      void flushLearnPersistence().catch((error) => {
        console.error('failed to flush Learn persistence on mobile exit', error)
      })
    }
  }, [dispatch, mobile])

  const [mobileLeaveError, setMobileLeaveError] = useState('')
  const [mobileLeaving, setMobileLeaving] = useState(false)
  const mobileLeavingRef = useRef(false)
  const leaveMobileLearn = useCallback(async () => {
    if (mobileLeavingRef.current) return
    mobileLeavingRef.current = true
    setMobileLeaving(true)
    dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: false })
    try {
      // A fresh snapshot also lets the serialized writer recover after a failed write.
      setReviewModeInfo(old => ({ ...old }))
      await flushLearnPersistence()
      navigate('/mobile')
    } catch (error) {
      console.error('failed to flush Learn persistence before returning to menu', error)
      setMobileLeaveError('学习位置暂未完整保存，已暂停并保留此页。请重试后再返回菜单。')
    } finally {
      mobileLeavingRef.current = false
      setMobileLeaving(false)
    }
  }, [dispatch, navigate, setReviewModeInfo])

  // 在组件挂载和currentDictId改变时，检查当前字典是否存在，如果不存在，则将其重置为默认值
  useEffect(() => {
    const id = currentDictId
    if (!(id in idDictionaryMap)) {
      setCurrentDictId(DEFAULT_DICTIONARY_ID)
      setCurrentChapter(0)
      return
    }
  }, [currentDictId, setCurrentChapter, setCurrentDictId])

  const skipWord = useCallback(() => {
    dispatch({ type: TypingStateActionType.SKIP_WORD })
  }, [dispatch])

  useEffect(() => {
    const onBlur = () => {
      dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: false })
    }
    const onVisibilityChange = () => { if (document.hidden) onBlur() }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) onBlur() }
    if (mobile) {
      window.addEventListener('pagehide', onBlur)
      window.addEventListener('pageshow', onPageShow)
    }

    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onBlur)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [dispatch, mobile])

  useEffect(() => {
    state.chapterData.words?.length > 0 ? setIsLoading(false) : setIsLoading(true)
  }, [state.chapterData.words])

  useEffect(() => {
    if (!isLoading && autoStartPendingRef.current && !state.isFinished) {
      autoStartPendingRef.current = false
      dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: true })
    }
  }, [isLoading, state.isFinished, dispatch])

  const toggleSession = useCallback(() => {
    dispatch({ type: TypingStateActionType.TOGGLE_IS_TYPING })
  }, [dispatch])
  useSessionKeyboard({
    active: !mobile && state.isTyping,
    disabled: mobile || isLoading || state.isFinished,
    onToggle: toggleSession,
  })

  useEffect(() => {
    if (words.length === 0) return

    const setupIdentity = isReviewMode
      ? `learn:${String(
          reviewModeInfo.reviewRecord?.id ??
            reviewModeInfo.reviewRecord?.createTime ??
            'none',
        )}`
      : `typing:${currentDictId}:${currentChapter}`

    if (setupIdentityRef.current === setupIdentity) return
    setupIdentityRef.current = setupIdentity

    const initialIndex =
      isReviewMode && reviewModeInfo.reviewRecord?.index
        ? reviewModeInfo.reviewRecord.index
        : 0

    dispatch({
      type: TypingStateActionType.SETUP_CHAPTER,
      payload: {
        words,
        shouldShuffle: isReviewMode ? false : randomConfig.isOpen,
        initialIndex,
      },
    })
  }, [
    currentChapter,
    currentDictId,
    dispatch,
    isReviewMode,
    randomConfig.isOpen,
    reviewModeInfo.reviewRecord?.createTime,
    reviewModeInfo.reviewRecord?.id,
    reviewModeInfo.reviewRecord?.index,
    words,
  ])

  useEffect(() => {
    const record = reviewModeInfo.reviewRecord
    if (
      !isReviewMode ||
      !record ||
      !(shouldRotateOversizedLearnSession(record) || isLearnSessionOutsideExtraRound(record, loadLearnDailySession(record.dict)))
    ) {
      return
    }

    const sessionId = String(record.id ?? record.createTime)
    if (legacyRotationRef.current === sessionId) return
    legacyRotationRef.current = sessionId

    const rotated = {
      ...record,
      isFinished: true,
    }

    void putWordReviewRecord(rotated)
      .then(() => {
        appendDeveloperTrace({
          scope: 'runtime',
          event: 'oversized-learn-session-rotated',
          sessionId,
          index: record.index,
          queueLength: record.words.length,
          details: {
            sessionKind: record.sessionKind ?? 'legacy',
            reason: 'active-acquisition-cohort-over-20',
          },
        })
        setReviewModeInfo({
          isReviewMode: true,
          reviewRecord: undefined,
        })
        navigate('/learn', {
          replace: true,
          state: isLearnSessionOutsideExtraRound(record, loadLearnDailySession(record.dict)) ? { autoStart: true } : { idle: true },
        })
      })
      .catch((error) => {
        legacyRotationRef.current = null
        console.error(
          'failed to rotate oversized Learn session',
          error,
        )
      })
  }, [
    isReviewMode,
    navigate,
    reviewModeInfo.reviewRecord,
    setReviewModeInfo,
  ])

  useEffect(() => {
    // 当用户完成章节后且完成 word Record 数据保存，记录 chapter Record 数据,
    if (
      !isReviewMode &&
      state.isFinished &&
      !state.isSavingRecord
    ) {
      chapterLogUploader()
      saveChapterRecord(state)
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReviewMode, state.isFinished, state.isSavingRecord])

  useEffect(() => {
    // 启动计时器
    let intervalId: number
    if (state.isTyping) {
      intervalId = window.setInterval(() => {
        dispatch({ type: TypingStateActionType.TICK_TIMER })
      }, 1000)
    }
    return () => clearInterval(intervalId)
  }, [state.isTyping, dispatch])

  useConfetti(!mobile && state.isFinished)

  const totalWords = state.chapterData.words.length
  const currentPosition = totalWords > 0 ? Math.min(state.chapterData.index + 1, totalWords) : 0
  const progressPercent = totalWords > 0 ? (currentPosition / totalWords) * 100 : 0

  if (mobile && state.isFinished && reviewModeInfo.reviewRecord) {
    return <TypingContext.Provider value={{ state, dispatch }}>
      <MobileResult input={{
        record: reviewModeInfo.reviewRecord,
        sourceRecordIds: [...state.chapterData.wordRecordIds],
        activeSeconds: state.timerData.time,
      }} />
    </TypingContext.Provider>
  }

  return (
    <TypingContext.Provider value={{ state: state, dispatch }}>
      {!mobile && state.isFinished && !isReviewMode && <DonateCard />}
      {state.isFinished && (
        isReviewMode ? <LearnResultScreen /> : <ResultScreen />
      )}
      {mobile ? (
        <div ref={mobileShellRef} className="focus-mobile-learn-shell mobile-app mobile-study" data-mobile-learn-shell>
          <header className="focus-mobile-learn-header">
            <button type="button" className="focus-mobile-round-action"
              onClick={() => void leaveMobileLearn()} disabled={mobileLeaving}
              aria-label="返回主菜单" title="保存进度并返回主菜单">
              <ArrowLeft size={21} aria-hidden="true" />
            </button>
            <button type="button" className="focus-mobile-round-action"
              onClick={toggleSession}
              aria-label={state.isTyping ? '暂停学习' : '继续学习'}
              title={state.isTyping ? '暂停学习' : '继续学习'}>
              {state.isTyping ? <Pause size={19} aria-hidden="true" /> : <Play size={19} aria-hidden="true" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="focus-mobile-progress-track" aria-label="学习进度">
                <span style={{ width: progressPercent + '%' }} />
              </div>
              <p className="mt-1 text-right text-[11px]" style={{ color: 'var(--focus-text-muted)' }}>
                {currentPosition} / {totalWords}
              </p>
            </div>
          </header>
          <Dialog open={Boolean(mobileLeaveError || mobileLeaving)} onClose={() => { if (!mobileLeaving) setMobileLeaveError('') }} className="mobile-app mobile-save-shield">
            <Dialog.Panel className="mobile-save-dialog">
              <Dialog.Title as="h2">{mobileLeaving ? '正在保存学习位置' : '暂时无法返回菜单'}</Dialog.Title>
              <Dialog.Description>{mobileLeaving ? '请稍候，正在确认本机学习记录…' : mobileLeaveError}</Dialog.Description>
              {!mobileLeaving && <>
                <button type="button" className="mobile-start-link" autoFocus onClick={() => void leaveMobileLearn()}>重试保存并返回</button>
                <button type="button" className="mobile-result-back" onClick={() => setMobileLeaveError('')}>留在此页</button>
              </>}
            </Dialog.Panel>
          </Dialog>
          <main className="focus-mobile-learn-main">
            {isLoading ? (
              <div className="flex flex-1 items-center justify-center" role="status" aria-label="正在加载学习内容">
                <span className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-400 border-r-transparent" />
              </div>
            ) : (
              !state.isFinished && <WordPanel mobile />
            )}
          </main>
        </div>
      ) : (
        <>
          <Layout>
            <Header>
              <div className="focus-toolbar-primary-row" data-toolbar-row="primary">
                <ModeSwitcher />
                <SessionButton isLoading={isLoading} />
                <DictChapterButton learnMode={isReviewMode} />
              </div>
              <div className="focus-toolbar-icons-row" data-toolbar-row="icons">
                <PronunciationSwitcher learnMode={isReviewMode} />
                <Switcher learnMode={isReviewMode} />
                <div className="flex shrink-0 items-center gap-3" data-typing-primary-controls>
                  {!isLearnSurface && state.isShowSkip && (
                    <Tooltip content="跳过该词" className="shrink-0">
                      <button className="my-btn-primary w-20 shrink-0 whitespace-nowrap bg-orange-400"
                        type="button" onClick={skipWord}>
                        Skip
                      </button>
                    </Tooltip>
                  )}
                </div>
              </div>
            </Header>
            <div className="container mx-auto flex h-full flex-1 flex-col items-center justify-center pb-5">
              <div className="container relative mx-auto flex h-full flex-col items-center">
                <div className="container flex flex-grow items-center justify-center">
                  {isLoading ? (
                    <div className="flex flex-col items-center justify-center">
                      <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-indigo-400 border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"
                        role="status" />
                    </div>
                  ) : (
                    !state.isFinished && <WordPanel />
                  )}
                </div>
                {isLearnSurface ? <LearnLiveStats /> : <Speed />}
              </div>
            </div>
          </Layout>
          <WordList />
        </>
      )}
    </TypingContext.Provider>
  )
}

export default App
