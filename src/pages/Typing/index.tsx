import Layout from '../../components/Layout'
import ModeSwitcher from '@/components/ModeSwitcher'
import { DictChapterButton } from './components/DictChapterButton'
import PronunciationSwitcher from './components/PronunciationSwitcher'
import ResultScreen from './components/ResultScreen'
import Speed from './components/Speed'
import StartButton from './components/StartButton'
import Switcher from './components/Switcher'
import WordList from './components/WordList'
import WordPanel from './components/WordPanel'
import { useConfetti } from './hooks/useConfetti'
import { useWordList } from './hooks/useWordList'
import { appendDeveloperTrace } from '@/dev/diagnostic-trace'
import {
  shouldRotateOversizedLearnSession,
} from '@/learn/session'
import { TypingContext, TypingStateActionType, initialState, typingReducer } from './store'
import { DonateCard } from '@/components/DonateCard'
import LearnResultScreen from '@/pages/Learn/components/LearnResultScreen'
import Header from '@/components/Header'
import Tooltip from '@/components/Tooltip'
import { DEFAULT_DICTIONARY_ID } from '@/resources/defaultDictionary'
import { idDictionaryMap } from '@/resources/dictionary'
import {
  currentChapterAtom,
  currentDictIdAtom,
  isReviewModeAtom,
  randomConfigAtom,
  reviewModeInfoAtom,
  typingTransVisibleAtom,
} from '@/store'
import { IsDesktop, isLegal } from '@/utils'
import { useSaveChapterRecord } from '@/utils/db'
import { putWordReviewRecord } from '@/utils/db/review-record'
import { useMixPanelChapterLogUploader } from '@/utils/mixpanel'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import type React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { useImmerReducer } from 'use-immer'

const App: React.FC = () => {
  const typingTransVisible = useAtomValue(typingTransVisibleAtom)
  const [state, dispatch] = useImmerReducer(typingReducer, {
    ...structuredClone(initialState),
    isTransVisible: typingTransVisible,
  })
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
  const chapterLogUploader = useMixPanelChapterLogUploader(state)
  const saveChapterRecord = useSaveChapterRecord()

  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const isLearnSurface =
    isReviewMode || location.pathname.startsWith('/learn')

  useEffect(() => {
    // 检测用户设备
    if (!IsDesktop()) {
      setTimeout(() => {
        alert(
          ' Qwerty Plus 目的为提高键盘工作者的英语输入效率，目前暂未适配移动端，希望您使用桌面端浏览器访问。如您使用的是 Ipad 等平板电脑设备，可以使用外接键盘使用本软件。',
        )
      }, 500)
    }
  }, [])

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
    window.addEventListener('blur', onBlur)

    return () => {
      window.removeEventListener('blur', onBlur)
    }
  }, [dispatch])

  useEffect(() => {
    state.chapterData.words?.length > 0 ? setIsLoading(false) : setIsLoading(true)
  }, [state.chapterData.words])

  useEffect(() => {
    if (!state.isTyping) {
      const onKeyDown = (e: KeyboardEvent) => {
        if (!isLoading && e.key !== 'Enter' && (isLegal(e.key) || e.key === ' ') && !e.altKey && !e.ctrlKey && !e.metaKey) {
          e.preventDefault()
          dispatch({ type: TypingStateActionType.SET_IS_TYPING, payload: true })
        }
      }
      window.addEventListener('keydown', onKeyDown)

      return () => window.removeEventListener('keydown', onKeyDown)
    }
  }, [state.isTyping, isLoading, dispatch])

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
      !shouldRotateOversizedLearnSession(record)
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
          state: { idle: true },
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

  useConfetti(state.isFinished)

  return (
    <TypingContext.Provider value={{ state: state, dispatch }}>
      {state.isFinished && !isReviewMode && <DonateCard />}
      {state.isFinished && (
        isReviewMode ? <LearnResultScreen /> : <ResultScreen />
      )}
      <Layout>
        <Header>
          <ModeSwitcher />
          <DictChapterButton learnMode={isReviewMode} />
          <PronunciationSwitcher learnMode={isReviewMode} />
          <Switcher learnMode={isReviewMode} />
          <div
            className="flex shrink-0 items-center gap-3"
            data-typing-primary-controls
          >
            <StartButton isLoading={isLoading} />
            {!isLearnSurface && state.isShowSkip && (
              <Tooltip
                content="跳过该词"
                className="shrink-0"
              >
                <button
                  className="my-btn-primary w-20 shrink-0 whitespace-nowrap bg-orange-400"
                  type="button"
                  onClick={skipWord}
                >
                  Skip
                </button>
              </Tooltip>
            )}
          </div>
        </Header>
        <div className="container mx-auto flex h-full flex-1 flex-col items-center justify-center pb-5">
          <div className="container relative mx-auto flex h-full flex-col items-center">
            <div className="container flex flex-grow items-center justify-center">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center ">
                  <div
                    className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid  border-indigo-400 border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]"
                    role="status"
                  ></div>
                </div>
              ) : (
                !state.isFinished && <WordPanel />
              )}
            </div>
            <Speed />
          </div>
        </div>
      </Layout>
      <WordList />
    </TypingContext.Provider>
  )
}

export default App
