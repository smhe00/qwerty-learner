import { TypingContext, TypingStateActionType } from '../../store'
import type { TypingState } from '../../store/type'
import PrevAndNextWord from '../PrevAndNextWord'
import Progress from '../Progress'
import Phonetic from './components/Phonetic'
import Translation from './components/Translation'
import WordComponent from './components/Word'
import type { WordFinishResult } from './components/Word'
import { appendDeveloperTrace } from '@/dev/diagnostic-trace'
import { usePrefetchPronunciationSound } from '@/hooks/usePronunciation'
import {
  createLearnAcquisitionExercisePlanForState,
  createLearnAcquisitionState,
  getLearnAcquisitionScaffoldDecision,
} from '@/learn/acquisition'
import { trackLearnPersistence } from '@/learn/persistence'
import { resolveLearnAcquisitionCompletion } from '@/learn/progression'
import { pruneLearnSessionWord } from '@/learn/lifecycle'
import {
  type LearnItemKind,
  resolveLearnItemKindForWord,
} from '@/learn/session'
import type {
  ReviewHintLevel,
  ReviewHintMachineState,
} from '@/review/hint'
import { resolveReviewCompletion } from '@/review/progression'
import {
  getReviewAttemptRole,
  getWordComponentInstanceKey,
} from '@/review/session'
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
  const currentLearnItemKind: LearnItemKind =
    currentWord && reviewModeInfo.reviewRecord
      ? resolveLearnItemKindForWord(
          reviewModeInfo.reviewRecord,
          currentWord.name,
        )
      : 'review'
  const currentAcquisitionState =
    isReviewMode &&
    currentLearnItemKind === 'acquisition' &&
    currentWord
      ? reviewModeInfo.reviewRecord?.acquisitionStates?.[currentWord.name] ??
        createLearnAcquisitionState()
      : undefined
  const currentAcquisitionScaffold =
    getLearnAcquisitionScaffoldDecision(currentAcquisitionState)
  const currentPersistedHintState =
    isReviewMode && currentWord
      ? reviewModeInfo.reviewRecord?.hintStates?.[currentWord.name]
      : undefined
  const currentManagedHintInitialLevel: ReviewHintLevel | undefined =
    currentPersistedHintState?.stage !== undefined &&
    currentPersistedHintState.stage !== 'cold-probe'
      ? currentPersistedHintState.maxLevelReached ?? undefined
      : currentLearnItemKind === 'acquisition' &&
          currentAcquisitionScaffold?.level === 'S1'
        ? 1
        : undefined
  const currentManagedHintInitialPosition =
    currentPersistedHintState?.hintPosition ??
    (currentManagedHintInitialLevel !== undefined
      ? currentAcquisitionScaffold?.hintPosition
      : undefined)
  const currentExercisePlan =
    isReviewMode && currentWord
      ? currentLearnItemKind === 'acquisition' &&
        currentAcquisitionState &&
        currentAcquisitionState.phase !== 'complete' &&
        currentAcquisitionState.phase !== 'deferred'
        ? createLearnAcquisitionExercisePlanForState(
            currentAcquisitionState,
          )
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
  const currentAudioOwnerKey = currentWord
    ? `${state.chapterData.index}:${String(
        currentWordRenderKey,
      )}:${currentWord.name}`
    : 'none'

  useEffect(() => {
    setCurrentReviewHintLevel(currentManagedHintInitialLevel ?? null)
  }, [
    state.chapterData.index,
    wordComponentKey,
    currentManagedHintInitialLevel,
  ])

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

  const persistCurrentHintState = useCallback(
    (hintState: ReviewHintMachineState) => {
      if (!isReviewMode || !currentWord) return

      setReviewModeInfo((old) => {
        if (!old.reviewRecord) return old
        return {
          ...old,
          reviewRecord: {
            ...old.reviewRecord,
            hintStates: {
              ...(old.reviewRecord.hintStates ?? {}),
              [currentWord.name]: hintState,
            },
          },
        }
      })
    },
    [currentWord, isReviewMode, setReviewModeInfo],
  )

  const onFinish = useCallback(
    ({
      record,
      wrongCount,
      classification,
      reviewRatingDecision,
      lastWrongIndex,
      nextExerciseShadow,
    }: WordFinishResult) => {
      if (
        isReviewMode &&
        reviewModeInfo.reviewRecord?.isFinished === true
      ) {
        appendDeveloperTrace({
          scope: 'learn-terminal',
          event: 'finished-session-completion-blocked',
          word: currentWord?.name,
          sessionId: String(
            reviewModeInfo.reviewRecord.id ??
              reviewModeInfo.reviewRecord.createTime,
          ),
          index: state.chapterData.index,
          queueLength: state.chapterData.words.length,
          details: {
            reason: 'terminal-session-is-immutable',
          },
        })
        dispatch({
          type: TypingStateActionType.FINISH_CHAPTER,
        })
        return
      }

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

        const resolution = resolveReviewCompletion({
          queue: state.chapterData.words,
          currentIndex: state.chapterData.index,
          currentWord,
          ratingDecision: reviewRatingDecision,
          attemptRole: currentReviewAttemptRole,
          wrongCount,
          classification,
          exercisePlans:
            reviewModeInfo.reviewRecord?.exercisePlans,
          reinforcementCounts:
            reviewModeInfo.reviewRecord?.reinforcementCounts,
          itemStates:
            reviewModeInfo.reviewRecord?.itemStates,
          nextExerciseShadow,
        })

        let reviewStateCommitError: unknown
        try {
          setReviewModeInfo((old) => {
          if (!old.reviewRecord) return old

          const words: Word[] =
            resolution.projection.queue.map((word) => ({
              name: word.name,
              trans: [...word.trans],
              usphone: word.usphone,
              ukphone: word.ukphone,
              ...(word.notation !== undefined
                ? { notation: word.notation }
                : {}),
              ...(word.example !== undefined
                ? {
                    example: word.example.map((example) => ({
                      ...example,
                    })),
                  }
                : {}),
              ...(word.tags !== undefined
                ? { tags: [...word.tags] }
                : {}),
            }))

          const hintStates = {
            ...(old.reviewRecord.hintStates ?? {}),
          }
          delete hintStates[currentWord.name]

          return {
            ...old,
            reviewRecord: {
              ...old.reviewRecord,
              index: resolution.projection.index,
              words,
              isFinished:
                resolution.projection.isFinished,
              exercisePlans: resolution.exercisePlans,
              reinforcementCounts:
                resolution.reinforcementCounts,
              itemStates: resolution.itemStates,
              hintStates:
                Object.keys(hintStates).length > 0
                  ? hintStates
                  : undefined,
            },
          }
          })
        } catch (error) {
          reviewStateCommitError = error
          appendDeveloperTrace({
            scope: 'learn-terminal',
            event: 'review-state-commit-error',
            word: currentWord.name,
            index: state.chapterData.index,
            queueLength: state.chapterData.words.length,
            details: {
              action: resolution.action,
              message:
                error instanceof Error
                  ? error.message
                  : String(error),
            },
          })
          if (resolution.action !== 'finish') {
            throw error
          }
        }

        setCurrentWordExerciseCount(0)

        if (resolution.action === 'retry-current') {
          dispatch({
            type: TypingStateActionType.LOOP_CURRENT_WORD,
          })
          reloadCurrentWordComponent()
          return
        }

        if (resolution.action === 'advance') {
          dispatch({
            type: TypingStateActionType.NEXT_WORD,
            payload: {
              insertWord: resolution.insertWord,
            },
          })
          return
        }

        appendDeveloperTrace({
          scope: 'learn-terminal',
          event: 'ui-finish-dispatch',
          word: currentWord.name,
          index: state.chapterData.index,
          queueLength: state.chapterData.words.length,
          details: {
            sessionId: String(
              reviewModeInfo.reviewRecord?.id ??
                reviewModeInfo.reviewRecord?.createTime ??
                'unknown',
            ),
            reviewStateCommitError:
              reviewStateCommitError !== undefined,
          },
        })
        dispatch({
          type: TypingStateActionType.FINISH_CHAPTER,
        })
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

        const resolution = resolveLearnAcquisitionCompletion({
          queue: state.chapterData.words,
          currentIndex: state.chapterData.index,
          currentWord,
          state: acquisitionState,
          acquisitionStates:
            reviewModeInfo.reviewRecord?.acquisitionStates ?? {},
          record,
          lastWrongIndex,
          now: Math.floor(Date.now() / 1000),
        })
        const nextAcquisitionState = resolution.nextState
        const projection = resolution.projection

        let acquisitionStateCommitError: unknown
        try {
          setReviewModeInfo((old) => {
          if (!old.reviewRecord) return old

          const acquisitionStates = {
            ...(old.reviewRecord.acquisitionStates ?? {}),
            ...resolution.acquisitionStates,
          }
          const exercisePlans = {
            ...(old.reviewRecord.exercisePlans ?? {}),
          }

          if (
            nextAcquisitionState.phase === 'supported' ||
            nextAcquisitionState.phase === 'independent'
          ) {
            exercisePlans[currentWord.name] =
              createLearnAcquisitionExercisePlanForState(
                nextAcquisitionState,
              )
          } else {
            delete exercisePlans[currentWord.name]
          }

          const hintStates = {
            ...(old.reviewRecord.hintStates ?? {}),
          }
          delete hintStates[currentWord.name]

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
              hintStates:
                Object.keys(hintStates).length > 0
                  ? hintStates
                  : undefined,
            },
          }
          })
        } catch (error) {
          acquisitionStateCommitError = error
          appendDeveloperTrace({
            scope: 'learn-terminal',
            event: 'acquisition-state-commit-error',
            word: currentWord.name,
            index: state.chapterData.index,
            queueLength: state.chapterData.words.length,
            details: {
              finished: projection.isFinished,
              message:
                error instanceof Error
                  ? error.message
                  : String(error),
            },
          })
          if (!projection.isFinished) {
            throw error
          }
        }

        if (resolution.shouldPersistAdmission) {
          const now = Math.floor(Date.now() / 1000)
          void trackLearnPersistence(
            completeLearningAcquisition(
              currentDictId,
              currentWord.name,
              now,
            ),
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
            payload: { projectedWords: projection.queue },
          })
        } else {
          appendDeveloperTrace({
            scope: 'learn-terminal',
            event: 'ui-finish-dispatch',
            word: currentWord.name,
            index: state.chapterData.index,
            queueLength: state.chapterData.words.length,
            details: {
              sessionId: String(
                reviewModeInfo.reviewRecord?.id ??
                  reviewModeInfo.reviewRecord?.createTime ??
                  'unknown',
              ),
              acquisitionStateCommitError:
                acquisitionStateCommitError !== undefined,
            },
          })
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

  const isVisibleCopyAttempt =
    currentLearnItemKind === 'acquisition' &&
    currentExercisePlan?.condition.letters.mode === 'all-visible'
  const managedHintFlow =
    isReviewMode &&
    !isVisibleCopyAttempt &&
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
              data-learn-scaffold-level={
                currentLearnItemKind === 'acquisition'
                  ? currentAcquisitionScaffold?.level
                  : undefined
              }
              data-learn-scaffold-policy={
                currentLearnItemKind === 'acquisition'
                  ? currentAcquisitionScaffold?.policyVersion
                  : undefined
              }
              data-learn-scaffold-hint-position={
                currentLearnItemKind === 'acquisition'
                  ? currentAcquisitionScaffold?.hintPosition
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
                managedHintInitialLevel={currentManagedHintInitialLevel}
                managedHintInitialPosition={
                  currentManagedHintInitialPosition
                }
                managedHintInitialState={currentPersistedHintState}
                onHintLevelChange={setCurrentReviewHintLevel}
                onHintStateChange={persistCurrentHintState}
                audioOwnerKey={currentAudioOwnerKey}
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
