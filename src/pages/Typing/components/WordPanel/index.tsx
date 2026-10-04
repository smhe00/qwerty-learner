import { TypingContext, TypingStateActionType } from '../../store'
import type { TypingState } from '../../store/type'
import PrevAndNextWord from '../PrevAndNextWord'
import Progress from '../Progress'
import Phonetic from './components/Phonetic'
import Translation from './components/Translation'
import WordComponent from './components/Word'
import type { WordFinishResult } from './components/Word'
import { usePrefetchPronunciationSound } from '@/hooks/usePronunciation'
import {
  createLearnAcquisitionExercisePlan,
  createLearnAcquisitionState,
  decideLearnAcquisitionTransition,
  projectLearnAcquisitionProgress,
} from '@/learn/acquisition'
import { pruneLearnSessionWord } from '@/learn/lifecycle'
import type { LearnSessionKind } from '@/learn/session'
import {
  createCanonicalReviewProbePlan,
  materializeReviewExercisePlan,
} from '@/review/decision'
import type { ReviewHintLevel } from '@/review/hint'
import {
  decideReviewProgress,
  projectReviewProgress,
} from '@/review/machine'
import {
  MAX_REINFORCEMENT_GAP,
  getAdaptiveReinforcementGap,
  getReviewAttemptRole,
  getWordComponentInstanceKey,
} from '@/review/session'
import {
  createReviewItemMachineState,
  resolveCompletedReviewItem,
} from '@/review/state-machine'
import {
  completeLearningAcquisition,
  excludeLearningWord,
} from '@/review/repository'
import {
  currentDictIdAtom,
  isReviewModeAtom,
  isShowPrevAndNextWordAtom,
  loopWordConfigAtom,
  phoneticConfigAtom,
  reviewModeInfoAtom,
} from '@/store'
import type { Word } from '@/typings'
import { getFirstValidDictionaryExample } from '@/utils/dictionaryExample'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'

export default function WordPanel() {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!
  const phoneticConfig = useAtomValue(phoneticConfigAtom)
  const currentDictId = useAtomValue(currentDictIdAtom)
  const isShowPrevAndNextWord = useAtomValue(isShowPrevAndNextWordAtom)
  const [wordComponentKey, setWordComponentKey] = useState(0)
  const [currentWordExerciseCount, setCurrentWordExerciseCount] = useState(0)
  const [currentReviewHintLevel, setCurrentReviewHintLevel] =
    useState<ReviewHintLevel | null>(null)
  const [isLearnMenuOpen, setIsLearnMenuOpen] = useState(false)
  const [isExcludingWord, setIsExcludingWord] = useState(false)
  const { times: loopWordTimes } = useAtomValue(loopWordConfigAtom)
  const currentWord = state.chapterData.words[state.chapterData.index]
  const nextWord = state.chapterData.words[state.chapterData.index + 1] as Word | undefined

  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const setReviewModeInfo = useSetAtom(reviewModeInfoAtom)
  const isReviewMode = useAtomValue(isReviewModeAtom)
  const currentLearnItemKind: LearnSessionKind =
    reviewModeInfo.reviewRecord?.sessionKind ?? 'review'
  const currentAcquisitionState =
    isReviewMode &&
    currentLearnItemKind === 'acquisition' &&
    currentWord
      ? reviewModeInfo.reviewRecord?.acquisitionStates?.[currentWord.name] ??
        createLearnAcquisitionState()
      : undefined
  const currentExercisePlan =
    isReviewMode && currentWord
      ? currentLearnItemKind === 'acquisition' &&
        currentAcquisitionState &&
        currentAcquisitionState.phase !== 'complete' &&
        currentAcquisitionState.phase !== 'deferred'
        ? createLearnAcquisitionExercisePlan(currentAcquisitionState.phase)
        : reviewModeInfo.reviewRecord?.exercisePlans?.[currentWord.name]
      : undefined
  const currentReviewAttemptRole = getReviewAttemptRole({
    sessionKind: isReviewMode ? currentLearnItemKind : undefined,
    reinforcementUsed:
      isReviewMode && currentWord
        ? reviewModeInfo.reviewRecord?.reinforcementCounts?.[
            currentWord.name
          ] ?? 0
        : 0,
  })
  const currentWordComponentKey = getWordComponentInstanceKey({
    isReviewMode,
    reviewIndex: state.chapterData.index,
    reloadKey: wordComponentKey,
  })
  const currentWordRenderKey =
    currentLearnItemKind === 'acquisition' && currentAcquisitionState
      ? `${currentWordComponentKey}:${currentAcquisitionState.phase}`
      : currentWordComponentKey

  useEffect(() => {
    setCurrentReviewHintLevel(null)
  }, [state.chapterData.index, wordComponentKey])

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
    ({
      wrongCount,
      classification,
      reviewRatingDecision,
      nextExerciseShadow,
    }: WordFinishResult) => {
      if (
        isReviewMode &&
        currentWord &&
        currentLearnItemKind === 'review'
      ) {
        if (!reviewRatingDecision || !currentReviewAttemptRole) {
          console.error(
            'Review completion missing Rating Gate decision or attempt role',
          )
          return
        }

        const currentItemState =
          reviewModeInfo.reviewRecord?.itemStates?.[currentWord.name] ??
          createReviewItemMachineState()
        const requestReinforcement =
          reviewRatingDecision.eligible &&
          (wrongCount > 0 ||
            reviewRatingDecision.rating === 'again' ||
            reviewRatingDecision.rating === 'hard')
        const itemResolution = resolveCompletedReviewItem({
          state: currentItemState,
          attemptRole: currentReviewAttemptRole,
          decision: reviewRatingDecision,
          requestReinforcement,
        })

        if (itemResolution.kind === 'retry-canonical') {
          setReviewModeInfo((old) => {
            if (!old.reviewRecord) return old
            const exercisePlans = {
              ...(old.reviewRecord.exercisePlans ?? {}),
              [currentWord.name]: createCanonicalReviewProbePlan(),
            }
            const itemStates = {
              ...(old.reviewRecord.itemStates ?? {}),
              [currentWord.name]: itemResolution.state,
            }
            return {
              ...old,
              reviewRecord: {
                ...old.reviewRecord,
                exercisePlans,
                itemStates,
              },
            }
          })

          setCurrentWordExerciseCount(0)
          dispatch({ type: TypingStateActionType.LOOP_CURRENT_WORD })
          reloadCurrentWordComponent()
          return
        }

        const attemptGap =
          wrongCount > 0
            ? getAdaptiveReinforcementGap(wrongCount, classification)
            : MAX_REINFORCEMENT_GAP
        const decision = decideReviewProgress({
          queue: state.chapterData.words,
          currentIndex: state.chapterData.index,
          currentWord,
          currentExerciseCount: 0,
          loopWordTimes: 1,
          priorAccumulatedWrongCount: 0,
          attemptWrongCount: wrongCount,
          currentReinforcementGap: MAX_REINFORCEMENT_GAP,
          attemptReinforcementGap: attemptGap,
          reinforcementRemaining: itemResolution.insertReinforcement ? 1 : 0,
          requestReinforcement: itemResolution.insertReinforcement,
        })
        const projection = projectReviewProgress({
          queue: state.chapterData.words,
          currentIndex: state.chapterData.index,
          decision,
        })

        setReviewModeInfo((old) => {
          if (!old.reviewRecord) return old

          const exercisePlans = { ...(old.reviewRecord.exercisePlans ?? {}) }
          const reinforcementCounts = {
            ...(old.reviewRecord.reinforcementCounts ?? {}),
          }
          const itemStates = {
            ...(old.reviewRecord.itemStates ?? {}),
            [currentWord.name]: itemResolution.state,
          }

          if (decision.kind === 'advance' && decision.insertWord) {
            reinforcementCounts[currentWord.name] =
              (reinforcementCounts[currentWord.name] ?? 0) + 1

            if (nextExerciseShadow) {
              exercisePlans[currentWord.name] =
                materializeReviewExercisePlan(nextExerciseShadow)
            } else if (!exercisePlans[currentWord.name]) {
              exercisePlans[currentWord.name] =
                createCanonicalReviewProbePlan()
            }
          }

          const words: Word[] = projection.queue.map((word) => ({
            name: word.name,
            trans: [...word.trans],
            usphone: word.usphone,
            ukphone: word.ukphone,
            ...(word.notation !== undefined
              ? { notation: word.notation }
              : {}),
            ...(word.example !== undefined
              ? { example: word.example.map((example) => ({ ...example })) }
              : {}),
            ...(word.tags !== undefined ? { tags: [...word.tags] } : {}),
          }))

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
              itemStates,
            },
          }
        })

        setCurrentWordExerciseCount(0)

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

      if (
        isReviewMode &&
        currentWord &&
        currentLearnItemKind === 'acquisition'
      ) {
        // Learn Acquisition owns its own state machine. The shared word engine
        // only returns raw evidence; it never admits a word or mutates the
        // long-term scheduler.
        const acquisitionState =
          reviewModeInfo.reviewRecord?.acquisitionStates?.[
            currentWord.name
          ] ?? createLearnAcquisitionState()

        let nextAcquisitionState
        if (acquisitionState.phase === 'exposure') {
          const guided = decideLearnAcquisitionTransition(
            acquisitionState,
            { kind: 'exposure-complete' },
          )
          nextAcquisitionState = decideLearnAcquisitionTransition(
            guided,
            { kind: 'guided-committed' },
          )
        } else if (acquisitionState.phase === 'guided') {
          nextAcquisitionState = decideLearnAcquisitionTransition(
            acquisitionState,
            { kind: 'guided-committed' },
          )
        } else if (acquisitionState.phase === 'supported') {
          nextAcquisitionState = decideLearnAcquisitionTransition(
            acquisitionState,
            { kind: 'supported-complete' },
          )
        } else if (acquisitionState.phase === 'independent') {
          const independentClean =
            wrongCount === 0 &&
            classification.cause === 'clean' &&
            reviewEvidence.retrievalValidity === 'independent'
          nextAcquisitionState = decideLearnAcquisitionTransition(
            acquisitionState,
            {
              kind: 'independent-complete',
              independentClean,
            },
          )
        } else {
          console.error(
            'Acquisition completion reached terminal state',
            acquisitionState,
          )
          return
        }

        const projection = projectLearnAcquisitionProgress({
          queue: state.chapterData.words,
          currentIndex: state.chapterData.index,
          currentWord,
          nextState: nextAcquisitionState,
        })

        setReviewModeInfo((old) => {
          if (!old.reviewRecord) return old

          const acquisitionStates = {
            ...(old.reviewRecord.acquisitionStates ?? {}),
            [currentWord.name]: nextAcquisitionState,
          }
          const exercisePlans = {
            ...(old.reviewRecord.exercisePlans ?? {}),
          }

          if (
            nextAcquisitionState.phase === 'supported' ||
            nextAcquisitionState.phase === 'independent'
          ) {
            exercisePlans[currentWord.name] =
              createLearnAcquisitionExercisePlan(
                nextAcquisitionState.phase,
              )
          } else {
            delete exercisePlans[currentWord.name]
          }

          return {
            ...old,
            reviewRecord: {
              ...old.reviewRecord,
              index: projection.index,
              words: projection.queue,
              isFinished: projection.isFinished,
              exercisePlans:
                Object.keys(exercisePlans).length > 0
                  ? exercisePlans
                  : undefined,
              acquisitionStates,
            },
          }
        })

        if (nextAcquisitionState.phase === 'complete') {
          const now = Math.floor(Date.now() / 1000)
          void completeLearningAcquisition(
            currentDictId,
            currentWord.name,
            now,
          ).catch((error) => {
            console.error(
              'failed to persist completed acquisition state',
              error,
            )
          })
        }

        if (!projection.isFinished) {
          dispatch({
            type: TypingStateActionType.NEXT_WORD,
            payload: {
              insertWord: projection.insertWord,
            },
          })
        } else {
          dispatch({ type: TypingStateActionType.FINISH_CHAPTER })
        }
        return
      }

      // Ordinary Typing intentionally retains the upstream progression path.
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
      currentDictId,
      currentLearnItemKind,
      currentReviewAttemptRole,
      currentWordExerciseCount,
      loopWordTimes,
      state.chapterData.index,
      state.chapterData.words,
      currentWord,
      reviewModeInfo.reviewRecord?.acquisitionStates,
      reviewModeInfo.reviewRecord?.itemStates,
      isReviewMode,
      dispatch,
      reloadCurrentWordComponent,
      setReviewModeInfo,
    ],
  )

  const excludeCurrentLearnWord = useCallback(async () => {
    if (!isReviewMode || !currentWord || isExcludingWord) return

    const confirmed = window.confirm(
      `将 “${currentWord.name}” 移出学习计划？\n\n之后不会出现在 Learn 中，历史学习记录会保留。`,
    )
    if (!confirmed) return

    setIsExcludingWord(true)
    try {
      await excludeLearningWord(currentDictId, currentWord.name)

      setReviewModeInfo((old) => {
        if (!old.reviewRecord) return old
        return {
          ...old,
          reviewRecord: pruneLearnSessionWord(
            old.reviewRecord,
            currentWord.name,
          ),
        }
      })

      setCurrentWordExerciseCount(0)
      setCurrentReviewHintLevel(null)
      setIsLearnMenuOpen(false)

      dispatch({
        type: TypingStateActionType.REMOVE_WORD_FROM_QUEUE,
        word: currentWord.name,
      })
    } finally {
      setIsExcludingWord(false)
    }
  }, [
    currentDictId,
    currentWord,
    dispatch,
    isExcludingWord,
    isReviewMode,
    setReviewModeInfo,
  ])

  const onSkipWord = useCallback(
    (type: 'prev' | 'next') => {
      if (isReviewMode) return
      if (type === 'prev') {
        dispatch({ type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex: prevIndex })
      }

      if (type === 'next') {
        dispatch({ type: TypingStateActionType.SKIP_2_WORD_INDEX, newIndex: nextIndex })
      }
    },
    [dispatch, isReviewMode, prevIndex, nextIndex],
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

  const hasValidExample = Boolean(
    currentWord && getFirstValidDictionaryExample(currentWord),
  )
  const isAcquisitionRecall =
    currentLearnItemKind === 'acquisition' &&
    (currentAcquisitionState?.phase === 'supported' ||
      currentAcquisitionState?.phase === 'independent')
  const isColdSemanticProbe =
    isReviewMode &&
    currentReviewHintLevel === null &&
    (isAcquisitionRecall || currentReviewAttemptRole === 'cold')

  // Example is a semantic cue, not a cloze answer. Cold probe prefers the
  // masked context over translation; legacy dictionaries without examples
  // must always retain translation as the fallback semantic cue.
  const effectiveTranslationVisible = isColdSemanticProbe
    ? !hasValidExample
    : effectiveMeaningVisible
  const effectiveSemanticCueVisible =
    effectiveMeaningVisible || (isColdSemanticProbe && hasValidExample)

  const effectivePhoneticVisible =
    isReviewMode &&
    currentReviewHintLevel !== null &&
    currentReviewHintLevel >= 1
      ? true
      : hasAdaptiveReviewPresentation
        ? currentExercisePlan.condition.phonetic === 'visible'
        : baselinePhoneticVisible

  const managedHintFlow =
    isReviewMode &&
    (currentLearnItemKind === 'review' ||
      currentAcquisitionState?.phase === 'supported' ||
      currentAcquisitionState?.phase === 'independent')

  return (
    <div className="container flex h-full w-full flex-col items-center justify-center">
      <div className="container flex h-24 w-full shrink-0 grow-0 justify-between px-12 pt-10">
        {!isReviewMode && isShowPrevAndNextWord && state.isTyping && (
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
            <div
              className="relative"
              data-learn-acquisition-phase={
                currentLearnItemKind === 'acquisition'
                  ? currentAcquisitionState?.phase
                  : undefined
              }
            >
              {isReviewMode && (
                <div className="absolute -right-16 top-0 z-20">
                  <button
                    type="button"
                    aria-label="Learn 单词菜单"
                    title="Learn 单词菜单"
                    onClick={() => setIsLearnMenuOpen((open) => !open)}
                    className="rounded-md px-2 py-1 text-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                  >
                    ⋯
                  </button>
                  {isLearnMenuOpen && (
                    <div className="absolute right-0 mt-1 w-36 rounded-lg border border-gray-100 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                      <button
                        type="button"
                        disabled={isExcludingWord}
                        onClick={() => void excludeCurrentLearnWord()}
                        className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-700"
                      >
                        移出学习计划
                      </button>
                    </div>
                  )}
                </div>
              )}
              <WordComponent
                word={currentWord}
                onFinish={onFinish}
                meaningVisible={effectiveSemanticCueVisible}
                phoneticVisible={effectivePhoneticVisible}
                exercisePlan={currentExercisePlan}
                learnItemKind={
                  isReviewMode ? currentLearnItemKind : undefined
                }
                reviewAttemptRole={currentReviewAttemptRole}
                managedHintFlow={managedHintFlow}
                onHintLevelChange={setCurrentReviewHintLevel}
                key={currentWordRenderKey}
              />
              {effectivePhoneticVisible && <Phonetic word={currentWord} />}
              <Translation
                trans={currentWord.trans.join('；')}
                showTrans={effectiveTranslationVisible}
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
