import { TypingContext, TypingStateActionType } from '../../store'
import type { TypingState } from '../../store/type'
import PrevAndNextWord from '../PrevAndNextWord'
import Progress from '../Progress'
import Phonetic from './components/Phonetic'
import Translation from './components/Translation'
import WordComponent from './components/Word'
import type { WordFinishResult } from './components/Word'
import { usePrefetchPronunciationSound } from '@/hooks/usePronunciation'
import { materializeReviewExercisePlan } from '@/review/decision'
import {
  decideReviewProgress,
  projectReviewProgress,
} from '@/review/machine'
import {
  MAX_REINFORCEMENT_GAP,
  getAdaptiveReinforcementGap,
  getWordComponentInstanceKey,
} from '@/review/session'
import { MAX_REINFORCEMENT_PER_WORD_PER_SESSION } from '@/review/state-machine'
import { isReviewModeAtom, isShowPrevAndNextWordAtom, loopWordConfigAtom, phoneticConfigAtom, reviewModeInfoAtom } from '@/store'
import type { Word } from '@/typings'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useContext, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

export default function WordPanel() {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!
  const phoneticConfig = useAtomValue(phoneticConfigAtom)
  const isShowPrevAndNextWord = useAtomValue(isShowPrevAndNextWordAtom)
  const [wordComponentKey, setWordComponentKey] = useState(0)
  const [currentWordExerciseCount, setCurrentWordExerciseCount] = useState(0)
  const [currentReviewWrongCount, setCurrentReviewWrongCount] = useState(0)
  const [currentReviewGap, setCurrentReviewGap] = useState(MAX_REINFORCEMENT_GAP)
  const { times: loopWordTimes } = useAtomValue(loopWordConfigAtom)
  const currentWord = state.chapterData.words[state.chapterData.index]
  const nextWord = state.chapterData.words[state.chapterData.index + 1] as Word | undefined

  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const currentExercisePlan =
    isReviewMode && currentWord
      ? reviewModeInfo.reviewRecord?.exercisePlans?.[currentWord.name]
      : undefined
  const currentWordComponentKey = getWordComponentInstanceKey({
    isReviewMode,
    reviewIndex: state.chapterData.index,
    reloadKey: wordComponentKey,
  })

  const prevIndex = useMemo(() => {
    const newIndex = state.chapterData.index - 1
    return newIndex < 0 ? 0 : newIndex
  }, [state.chapterData.index])
  const nextIndex = useMemo(() => {
    const newIndex = state.chapterData.index + 1
    return newIndex > state.chapterData.words.length - 1 ? state.chapterData.words.length - 1 : newIndex
  }, [state.chapterData.index, state.chapterData.words.length])

  usePrefetchPronunciationSound(nextWord?.name)

  const reloadCurrentWordComponent = useCallback(() => {
    setWordComponentKey((old) => old + 1)
  }, [])

  const onFinish = useCallback(
    ({ wrongCount, classification, nextExerciseShadow }: WordFinishResult) => {
      if (isReviewMode && currentWord) {
        const attemptGap =
          wrongCount > 0
            ? getAdaptiveReinforcementGap(wrongCount, classification)
            : MAX_REINFORCEMENT_GAP
        const reinforcementUsed =
          reviewModeInfo.reviewRecord?.reinforcementCounts?.[currentWord.name] ?? 0
        const reinforcementRemaining = Math.max(
          0,
          MAX_REINFORCEMENT_PER_WORD_PER_SESSION - reinforcementUsed,
        )

        const decision = decideReviewProgress({
          queue: state.chapterData.words,
          currentIndex: state.chapterData.index,
          currentWord,
          currentExerciseCount: currentWordExerciseCount,
          loopWordTimes,
          priorAccumulatedWrongCount: currentReviewWrongCount,
          attemptWrongCount: wrongCount,
          currentReinforcementGap: currentReviewGap,
          attemptReinforcementGap: attemptGap,
          reinforcementRemaining,
        })
        const projection = projectReviewProgress({
          queue: state.chapterData.words,
          currentIndex: state.chapterData.index,
          decision,
        })

        // Persist one atomic Review snapshot outside the Typing reducer.
        // Reducers stay pure; React/Jotai side effects are not executed during
        // Immer reducer evaluation.
        setReviewModeInfo((old) => {
          if (!old.reviewRecord) return old

          const exercisePlans = { ...(old.reviewRecord.exercisePlans ?? {}) }
          const reinforcementCounts = {
            ...(old.reviewRecord.reinforcementCounts ?? {}),
          }

          if (decision.kind === 'advance' && decision.insertWord) {
            reinforcementCounts[currentWord.name] =
              (reinforcementCounts[currentWord.name] ?? 0) + 1
          }

          if (nextExerciseShadow !== undefined) {
            if (nextExerciseShadow) {
              exercisePlans[currentWord.name] =
                materializeReviewExercisePlan(nextExerciseShadow)
            } else {
              delete exercisePlans[currentWord.name]
            }
          }

          const words: Word[] = projection.queue.map((word) => {
            const persistedWord: Word = {
              name: word.name,
              trans: word.trans,
              usphone: word.usphone,
              ukphone: word.ukphone,
            }
            if (word.notation !== undefined) {
              persistedWord.notation = word.notation
            }
            return persistedWord
          })

          return {
            ...old,
            reviewRecord: {
              ...old.reviewRecord,
              index: projection.index,
              words,
              isFinished: projection.isFinished,
              exercisePlans:
                Object.keys(exercisePlans).length > 0
                  ? exercisePlans
                  : undefined,
              reinforcementCounts:
                Object.keys(reinforcementCounts).length > 0
                  ? reinforcementCounts
                  : undefined,
            },
          }
        })

        if (decision.kind === 'loop-current') {
          setCurrentWordExerciseCount(decision.nextExerciseCount)
          setCurrentReviewWrongCount(decision.nextAccumulatedWrongCount)
          setCurrentReviewGap(decision.nextReinforcementGap)
          dispatch({ type: TypingStateActionType.LOOP_CURRENT_WORD })
          reloadCurrentWordComponent()
          return
        }

        setCurrentWordExerciseCount(0)
        setCurrentReviewWrongCount(0)
        setCurrentReviewGap(MAX_REINFORCEMENT_GAP)

        if (decision.kind === 'advance') {
          dispatch({
            type: TypingStateActionType.NEXT_WORD,
            payload: {
              insertWord: decision.insertWord,
            },
          })
          return
        }

        dispatch({ type: TypingStateActionType.FINISH_CHAPTER })
        return
      }

      // Ordinary learning intentionally retains the upstream progression path.
      const hasMoreLoopExercises =
        currentWordExerciseCount < loopWordTimes - 1
      const hasNextWord =
        state.chapterData.index < state.chapterData.words.length - 1

      if (hasNextWord || hasMoreLoopExercises) {
        if (hasMoreLoopExercises) {
          setCurrentWordExerciseCount((old) => old + 1)
          dispatch({ type: TypingStateActionType.LOOP_CURRENT_WORD })
          reloadCurrentWordComponent()
        } else {
          setCurrentWordExerciseCount(0)
          dispatch({ type: TypingStateActionType.NEXT_WORD })
        }
        return
      }

      dispatch({ type: TypingStateActionType.FINISH_CHAPTER })
    },
    [
      currentReviewWrongCount,
      currentReviewGap,
      currentWordExerciseCount,
      loopWordTimes,
      state.chapterData.index,
      state.chapterData.words,
      currentWord,
      reviewModeInfo.reviewRecord?.reinforcementCounts,
      isReviewMode,
      dispatch,
      reloadCurrentWordComponent,
      setReviewModeInfo,
    ],
  )

  const onSkipWord = useCallback(
    (type: 'prev' | 'next') => {
      if (type === 'prev') {
        dispatch({ type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex: prevIndex })
      }

      if (type === 'next') {
        dispatch({ type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex: nextIndex })
      }
    },
    [dispatch, prevIndex, nextIndex],
  )

  useHotkeys(
    'Ctrl + Shift + ArrowLeft',
    (e) => {
      e.preventDefault()
      onSkipWord('prev')
    },
    { preventDefault: true },
  )

  useHotkeys(
    'Ctrl + Shift + ArrowRight',
    (e) => {
      e.preventDefault()
      onSkipWord('next')
    },
    { preventDefault: true },
  )
  const [isShowTranslation, setIsHoveringTranslation] = useState(false)

  const handleShowTranslation = useCallback((checked: boolean) => {
    setIsHoveringTranslation(checked)
  }, [])

  useHotkeys(
    'tab',
    () => {
      handleShowTranslation(true)
    },
    { enableOnFormTags: true, preventDefault: true },
    [],
  )

  useHotkeys(
    'tab',
    () => {
      handleShowTranslation(false)
    },
    { enableOnFormTags: true, keyup: true, preventDefault: true },
    [],
  )

  const shouldShowTranslation = useMemo(() => {
    return isShowTranslation || state.isTransVisible
  }, [isShowTranslation, state.isTransVisible])

  const baselinePhoneticVisible = useMemo(() => {
    if (!phoneticConfig.isOpen || !currentWord) return false
    const phonetic = phoneticConfig.type === 'us' ? currentWord.usphone : currentWord.ukphone
    return Boolean(phonetic && phonetic.length > 1)
  }, [currentWord, phoneticConfig.isOpen, phoneticConfig.type])

  const hasAdaptiveReviewPresentation =
    isReviewMode &&
    currentExercisePlan?.condition.source === 'adaptive-policy'

  const effectiveMeaningVisible = hasAdaptiveReviewPresentation
    ? currentExercisePlan.condition.meaning === 'visible'
    : shouldShowTranslation

  const effectivePhoneticVisible = hasAdaptiveReviewPresentation
    ? currentExercisePlan.condition.phonetic === 'visible'
    : baselinePhoneticVisible

  return (
    <div className="container flex h-full w-full flex-col items-center justify-center">
      <div className="container flex h-24 w-full shrink-0 grow-0 justify-between px-12 pt-10">
        {isShowPrevAndNextWord && state.isTyping && (
          <>
            <PrevAndNextWord type="prev" />
            <PrevAndNextWord type="next" />
          </>
        )}
      </div>
      <div className="container flex flex-grow flex-col items-center justify-center">
        {currentWord && (
          <div className="relative flex w-full justify-center">
            {!state.isTyping && (
              <div className="absolute flex h-full w-full justify-center">
                <div className="z-10 flex w-full items-center backdrop-blur-sm">
                  <p className="w-full select-none text-center text-xl text-gray-600 dark:text-gray-50">
                    按任意键{state.timerData.time ? '继续' : '开始'}
                  </p>
                </div>
              </div>
            )}
            <div className="relative">
              <WordComponent
                word={currentWord}
                onFinish={onFinish}
                meaningVisible={effectiveMeaningVisible}
                phoneticVisible={effectivePhoneticVisible}
                exercisePlan={currentExercisePlan}
                key={currentWordComponentKey}
              />
              {effectivePhoneticVisible && <Phonetic word={currentWord} />}
              <Translation
                trans={currentWord.trans.join('；')}
                showTrans={effectiveMeaningVisible}
                onMouseEnter={() => handleShowTranslation(true)}
                onMouseLeave={() => handleShowTranslation(false)}
              />
            </div>
          </div>
        )}
      </div>
      <Progress className={`mb-10 mt-auto ${state.isTyping ? 'opacity-100' : 'opacity-0'}`} />
    </div>
  )
}
