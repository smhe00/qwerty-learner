import type { WordUpdateAction } from '../InputHandler'
import InputHandler from '../InputHandler'
import Letter from './Letter'
import Notation from './Notation'
import { TipAlert } from './TipAlert'
import style from './index.module.css'
import { initialWordState } from './type'
import type { WordState } from './type'
import Tooltip from '@/components/Tooltip'
import type { WordPronunciationIconRef } from '@/components/WordPronunciationIcon'
import { WordPronunciationIcon } from '@/components/WordPronunciationIcon'
import { EXPLICIT_SPACE } from '@/constants'
import useKeySounds from '@/hooks/useKeySounds'
import type { LearnSessionKind } from '@/learn/session'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import { classifyTypingError } from '@/review/classifier'
import type { TypingErrorClassification } from '@/review/classifier'
import {
  createBaselineExerciseCondition,
  isLetterVisibleForExerciseCondition,
} from '@/review/condition'
import type { ExerciseConditionV1 } from '@/review/condition'
import { CANONICAL_REVIEW_PROBE_POLICY_VERSION } from '@/review/decision'
import type {
  ReviewExercisePlanV1,
  ReviewPolicyDecisionV1,
  ReviewPolicyShadowV1,
} from '@/review/decision'
import { evaluateReviewEvidence } from '@/review/evidence'
import type { WordHistorySummary } from '@/review/features'
import {
  chooseNextExerciseShadow,
  resolveExercisePlanForAttempt,
} from '@/review/exercise-policy'
import { loadWordReviewHistory } from '@/review/history'
import {
  REVIEW_HINT_POLICY_VERSION,
  applyReviewHintDecision,
  createReviewHintMachineState,
  createReviewHintPlan,
  decideReviewHintInput,
  observeReviewHintWrong,
} from '@/review/hint'
import type {
  ReviewHintInputDecision,
  ReviewHintLevel,
} from '@/review/hint'
import {
  LearningContextCollector,
  calculateAnswerVisibleRatio,
  summarizeAnswerVisibility,
} from '@/review/learning-context'
import {
  decideWordInput,
  shouldPlayAutomaticPronunciation,
} from '@/review/machine'
import {
  applyReviewOutcome,
  completeLearningAcquisition,
} from '@/review/repository'
import { reviewOutcomeForAttempt } from '@/review/scheduler'
import { WordTelemetryCollector } from '@/review/telemetry'
import {
  currentChapterAtom,
  currentDictInfoAtom,
  isIgnoreCaseAtom,
  isShowAnswerOnHoverAtom,
  isTextSelectableAtom,
  pronunciationIsOpenAtom,
  wordDictationConfigAtom,
} from '@/store'
import type { Word } from '@/typings'
import { CTRL, getUtcStringForMixpanel } from '@/utils'
import { useSaveWordRecord } from '@/utils/db'
import type { IWordRecord, PronunciationCue } from '@/utils/db/record'
import { useAtomValue } from 'jotai'
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useImmer } from 'use-immer'

const vowelLetters = ['A', 'E', 'I', 'O', 'U']

export type WordFinishResult = {
  wrongCount: number
  classification: TypingErrorClassification
  nextExerciseShadow?: ReviewPolicyShadowV1 | null
}

type WordComponentProps = {
  word: Word
  onFinish: (result: WordFinishResult) => void
  meaningVisible: boolean
  phoneticVisible: boolean
  exercisePlan?: ReviewExercisePlanV1
  learnItemKind?: LearnSessionKind
  onHintLevelChange?: (level: ReviewHintLevel | null) => void
}

export default function WordComponent({
  word,
  onFinish,
  meaningVisible,
  phoneticVisible,
  exercisePlan,
  learnItemKind,
  onHintLevelChange,
}: WordComponentProps) {
  // eslint-disable-next-line  @typescript-eslint/no-non-null-assertion
  const { state, dispatch } = useContext(TypingContext)!
  const [wordState, setWordState] = useImmer<WordState>(structuredClone(initialWordState))

  const wordDictationConfig = useAtomValue(wordDictationConfigAtom)
  const isTextSelectable = useAtomValue(isTextSelectableAtom)
  const isIgnoreCase = useAtomValue(isIgnoreCaseAtom)
  const isShowAnswerOnHover = useAtomValue(isShowAnswerOnHoverAtom)
  const saveWordRecord = useSaveWordRecord()
  // const wordLogUploader = useMixPanelWordLogUploader(state)
  const [playKeySound, playBeepSound, playHintSound] = useKeySounds()
  const pronunciationIsOpen = useAtomValue(pronunciationIsOpenAtom)
  const [isHoveringWord, setIsHoveringWord] = useState(false)
  const [activeHintLevel, setActiveHintLevel] = useState<ReviewHintLevel | null>(null)
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const currentLanguage = currentDictInfo.language
  const currentLanguageCategory = currentDictInfo.languageCategory
  const currentChapter = useAtomValue(currentChapterAtom)

  const [showTipAlert, setShowTipAlert] = useState(false)
  const wordPronunciationIconRef = useRef<WordPronunciationIconRef>(null)
  const telemetryCollectorRef = useRef(new WordTelemetryCollector())
  const learningContextCollectorRef = useRef(new LearningContextCollector())
  const previousMeaningVisibleRef = useRef(meaningVisible)
  const historySummaryRef = useRef<WordHistorySummary | undefined>(undefined)
  const historyRecordsRef = useRef<IWordRecord[]>([])
  const exerciseConditionRef = useRef<ExerciseConditionV1 | undefined>(undefined)
  const reviewPolicyDecisionRef = useRef<ReviewPolicyDecisionV1 | undefined>(undefined)
  const acceptedInputLengthRef = useRef(0)
  const inputLockedRef = useRef(false)
  const automaticPronunciationPlayedRef = useRef(false)
  const finishNotifiedRef = useRef(false)
  const targetLengthRef = useRef(0)
  const reviewHintStateRef = useRef(createReviewHintMachineState())

  useLayoutEffect(() => {
    // Resolve the frozen presentation before paint / first input.
    telemetryCollectorRef.current.resetWord()
    acceptedInputLengthRef.current = 0
    inputLockedRef.current = false
    automaticPronunciationPlayedRef.current = false
    finishNotifiedRef.current = false
    reviewHintStateRef.current = createReviewHintMachineState()
    setActiveHintLevel(null)
    onHintLevelChange?.(null)
    dispatch({ type: TypingStateActionType.SET_SKIP_LOCKED, payload: false })

    let headword = ''
    try {
      headword = word.name.replace(new RegExp(' ', 'g'), EXPLICIT_SPACE)
      headword = headword.replace(new RegExp('…', 'g'), '..')
    } catch (e) {
      console.error('word.name is not a string', word)
      headword = ''
    }

    const newWordState = structuredClone(initialWordState)
    newWordState.displayWord = headword
    targetLengthRef.current = headword.length
    newWordState.letterStates = new Array(headword.length).fill('normal')
    newWordState.startTime = getUtcStringForMixpanel()
    newWordState.randomLetterVisible = headword.split('').map(() => Math.random() > 0.4)

    const initialLetterVisibility = headword.split('').map((letter, index) => {
      if (isShowAnswerOnHover && isHoveringWord) return true
      if (!wordDictationConfig.isOpen) return true
      if (wordDictationConfig.type === 'hideAll') return false
      if (wordDictationConfig.type === 'hideVowel') return !vowelLetters.includes(letter.toUpperCase())
      if (wordDictationConfig.type === 'hideConsonant') return vowelLetters.includes(letter.toUpperCase())
      return newWordState.randomLetterVisible[index]
    })

    const baselineCondition = createBaselineExerciseCondition({
      pronunciationEnabled: pronunciationIsOpen,
      meaningVisible,
      phoneticVisible,
      letterVisibility: initialLetterVisibility,
    })
    const appliedPlan = resolveExercisePlanForAttempt(
      baselineCondition,
      exercisePlan,
    )
    const appliedLetterVisibility = initialLetterVisibility.map(
      (fallbackVisible, index) =>
        isLetterVisibleForExerciseCondition(
          appliedPlan.condition,
          index,
          fallbackVisible,
        ),
    )

    exerciseConditionRef.current = appliedPlan.condition
    reviewPolicyDecisionRef.current = appliedPlan.decision

    learningContextCollectorRef.current.reset({
      answerVisibilityAtStart: summarizeAnswerVisibility(appliedLetterVisibility),
      answerVisibleRatioAtStart: calculateAnswerVisibleRatio(appliedLetterVisibility),
      meaningVisibleAtStart: meaningVisible,
      phoneticVisibleAtStart: phoneticVisible,
      pronunciationEnabledAtStart:
        appliedPlan.condition.audio === 'automatic',
    })
    previousMeaningVisibleRef.current = meaningVisible

    setWordState(newWordState)
    // Capture start-of-word conditions only. Mid-word config changes belong to
    // the next observation rather than retroactively changing this one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [word, setWordState])

  useEffect(() => {
    if (state.isTyping) {
      const now = Date.now()
      if (document.hidden || !document.hasFocus()) {
        telemetryCollectorRef.current.pause(now)
      }
      telemetryCollectorRef.current.markReady(now)
    }
  }, [state.isTyping, word])

  useEffect(() => {
    const pause = () => telemetryCollectorRef.current.pause(Date.now())
    const resumeIfActive = () => {
      if (!document.hidden && document.hasFocus()) {
        telemetryCollectorRef.current.resume(Date.now())
      }
    }
    const handleVisibilityChange = () => {
      if (document.hidden) {
        pause()
      } else {
        resumeIfActive()
      }
    }

    window.addEventListener('blur', pause)
    window.addEventListener('focus', resumeIfActive)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    if (document.hidden || !document.hasFocus()) {
      pause()
    }

    return () => {
      window.removeEventListener('blur', pause)
      window.removeEventListener('focus', resumeIfActive)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [word])

  useEffect(() => {
    if (meaningVisible && !previousMeaningVisibleRef.current) {
      learningContextCollectorRef.current.recordMeaningReveal()
    }
    previousMeaningVisibleRef.current = meaningVisible
  }, [meaningVisible, word])

  useEffect(() => {
    let cancelled = false
    historySummaryRef.current = undefined
    historyRecordsRef.current = []

    loadWordReviewHistory(currentDictInfo.id, word.name)
      .then((history) => {
        if (!cancelled) {
          historySummaryRef.current = history.summary
          historyRecordsRef.current = history.records
        }
      })
      .catch((error) => {
        console.warn('failed to load review word history', error)
      })

    return () => {
      cancelled = true
    }
  }, [currentDictInfo.id, word.name])

  const isManagedReviewHintFlow = useCallback(() => {
    const policyVersion = reviewPolicyDecisionRef.current?.policyVersion
    return (
      currentChapter === -1 &&
      (policyVersion === CANONICAL_REVIEW_PROBE_POLICY_VERSION ||
        policyVersion === REVIEW_HINT_POLICY_VERSION)
    )
  }, [currentChapter])

  const activateReviewHint = useCallback(
    (
      decision: Extract<
        ReviewHintInputDecision,
        { kind: 'advance-hint' }
      >,
    ) => {
      const nextHintState = applyReviewHintDecision(
        reviewHintStateRef.current,
        decision,
      )
      reviewHintStateRef.current = nextHintState

      const hintPlan = createReviewHintPlan(
        decision.level,
        targetLengthRef.current,
        decision.hintPosition,
        nextHintState.forcedRevealPositions,
      )
      exerciseConditionRef.current = hintPlan.condition
      reviewPolicyDecisionRef.current = hintPlan.decision
      learningContextCollectorRef.current.recordReviewHintAdvance(
        decision.level,
        decision.coldProbeSurrendered,
        {
          hintPosition: decision.hintPosition,
          autoHint0Triggered:
            decision.trigger === 'repeated-wrong-position',
        },
      )

      setActiveHintLevel(decision.level)
      onHintLevelChange?.(decision.level)
      setIsHoveringWord(false)

      if (decision.level === 1) {
        // Hint 1 introduces pronunciation for the first time.
        automaticPronunciationPlayedRef.current = false
      }

      if (decision.level === 3) {
        learningContextCollectorRef.current.recordAnswerReveal(Date.now())
        dispatch({
          type: TypingStateActionType.SET_SKIP_LOCKED,
          payload: true,
        })
      }
    },
    [dispatch, onHintLevelChange],
  )

  const updateInput = useCallback(
    (updateAction: WordUpdateAction) => {
      switch (updateAction.type) {
        case 'add': {
          if (isManagedReviewHintFlow()) {
            const hintDecision = decideReviewHintInput({
              state: reviewHintStateRef.current,
              inputIndex: acceptedInputLengthRef.current,
              key: updateAction.value,
            })

            if (hintDecision.kind === 'advance-hint') {
              updateAction.event.preventDefault()
              activateReviewHint(hintDecision)
              return
            }
          }

          const inputDecision = decideWordInput({
            inputLength: acceptedInputLengthRef.current,
            targetLength: targetLengthRef.current,
            hasWrong: wordState.hasWrong,
            isFinished: inputLockedRef.current,
          })
          if (!inputDecision.accept) return

          acceptedInputLengthRef.current += 1
          if (inputDecision.isFinal) {
            inputLockedRef.current = true
          }

          const now = Date.now()
          learningContextCollectorRef.current.recordInputStarted(now)
          telemetryCollectorRef.current.recordKey(now)

          if (updateAction.value === ' ') {
            updateAction.event.preventDefault()
            setWordState((state) => {
              state.inputWord = state.inputWord + EXPLICIT_SPACE
            })
          } else {
            setWordState((state) => {
              state.inputWord = state.inputWord + updateAction.value
            })
          }
          break
        }

        default:
          console.warn('unknown update type', updateAction)
      }
    },
    [
      activateReviewHint,
      dispatch,
      isManagedReviewHintFlow,
      onHintLevelChange,
      setWordState,
      wordState.hasWrong,
    ],
  )

  const handleHoverWord = useCallback(
    (checked: boolean) => {
      if (
        checked &&
        isManagedReviewHintFlow() &&
        reviewHintStateRef.current.stage !== 'hint-3'
      ) {
        return
      }

      if (checked && isShowAnswerOnHover) {
        learningContextCollectorRef.current.recordAnswerReveal(Date.now())
      }
      setIsHoveringWord(checked)
    },
    [isManagedReviewHintFlow, isShowAnswerOnHover],
  )

  const playPronunciation = useCallback((cue: PronunciationCue): boolean => {
    const play = wordPronunciationIconRef.current?.play
    if (!play) return false

    learningContextCollectorRef.current.recordPronunciationPlayed(cue)
    play()
    return true
  }, [])

  useHotkeys(
    'tab',
    () => {
      handleHoverWord(true)
    },
    { enableOnFormTags: true, preventDefault: true },
    [],
  )

  useHotkeys(
    'tab',
    () => {
      handleHoverWord(false)
    },
    { enableOnFormTags: true, keyup: true, preventDefault: true },
    [],
  )
  useHotkeys(
    'ctrl+j',
    () => {
      if (state.isTyping) {
        playPronunciation('requested')
      }
    },
    [state.isTyping],
    { enableOnFormTags: true, preventDefault: true },
  )

  useEffect(() => {
    const shouldPlay = shouldPlayAutomaticPronunciation({
      isTyping: state.isTyping,
      inputLength: wordState.inputWord.length,
      automaticAudioEnabled:
        exerciseConditionRef.current?.audio === 'automatic',
      alreadyPlayedForAttempt: automaticPronunciationPlayedRef.current,
    })

    if (shouldPlay && playPronunciation('automatic')) {
      automaticPronunciationPlayedRef.current = true
    }
  }, [
    activeHintLevel,
    playPronunciation,
    state.isTyping,
    wordState.inputWord.length,
  ])

  const getLetterVisible = useCallback(
    (index: number) => {
      const activeCondition = exerciseConditionRef.current
      if (wordState.letterStates[index] === 'correct') return true

      const managedHintFlow = isManagedReviewHintFlow()
      if (
        !managedHintFlow &&
        isShowAnswerOnHover &&
        isHoveringWord
      ) {
        return true
      }

      if (activeCondition?.source === 'adaptive-policy') {
        return isLetterVisibleForExerciseCondition(
          activeCondition,
          index,
          true,
        )
      }

      if (wordDictationConfig.isOpen) {
        if (wordDictationConfig.type === 'hideAll') return false

        const letter = wordState.displayWord[index]
        if (wordDictationConfig.type === 'hideVowel') {
          return vowelLetters.includes(letter.toUpperCase()) ? false : true
        }
        if (wordDictationConfig.type === 'hideConsonant') {
          return vowelLetters.includes(letter.toUpperCase()) ? true : false
        }
        if (wordDictationConfig.type === 'randomHide') {
          return wordState.randomLetterVisible[index]
        }
      }
      return true
    },
    [
      isHoveringWord,
      isManagedReviewHintFlow,
      isShowAnswerOnHover,
      wordDictationConfig.isOpen,
      wordDictationConfig.type,
      wordState.displayWord,
      wordState.letterStates,
      wordState.randomLetterVisible,
    ],
  )

  useEffect(() => {
    const inputLength = wordState.inputWord.length
    /**
     * TODO: 当用户输入错误时，会报错
     * Cannot update a component (`App`) while rendering a different component (`WordComponent`). To locate the bad setState() call inside `WordComponent`, follow the stack trace as described in https://reactjs.org/link/setstate-in-render
     * 目前不影响生产环境，猜测是因为开发环境下 react 会两次调用 useEffect 从而展示了这个 warning
     * 但这终究是一个 bug，需要修复
     */
    if (wordState.hasWrong || inputLength === 0 || wordState.displayWord.length === 0) {
      return
    }

    const inputChar = wordState.inputWord[inputLength - 1]
    const correctChar = wordState.displayWord[inputLength - 1]
    let isEqual = false
    if (inputChar != undefined && correctChar != undefined) {
      isEqual = isIgnoreCase ? inputChar.toLowerCase() === correctChar.toLowerCase() : inputChar === correctChar
    }

    if (isEqual) {
      // 输入正确时
      setWordState((state) => {
        state.letterTimeArray.push(Date.now())
        state.correctCount += 1
      })

      if (inputLength >= wordState.displayWord.length) {
        // 完成输入时
        telemetryCollectorRef.current.recordClean(inputLength, Date.now())
        setWordState((state) => {
          state.letterStates[inputLength - 1] = 'correct'
          state.isFinished = true
          state.endTime = getUtcStringForMixpanel()
        })
        playHintSound()
      } else {
        setWordState((state) => {
          state.letterStates[inputLength - 1] = 'correct'
        })
        playKeySound()
      }

      dispatch({ type: TypingStateActionType.REPORT_CORRECT_WORD })
    } else {
      // 出错时
      playBeepSound()
      const wrongIndex = inputLength - 1
      const wrongRecorded = telemetryCollectorRef.current.recordWrong(
        wrongIndex,
        wrongIndex,
        inputChar,
        Date.now(),
      )

      if (wrongRecorded && isManagedReviewHintFlow()) {
        const previousForcedRevealKey =
          reviewHintStateRef.current.forcedRevealPositions.join(',')
        const observation = observeReviewHintWrong({
          state: reviewHintStateRef.current,
          wrongIndex,
          wordLength: targetLengthRef.current,
        })
        reviewHintStateRef.current = observation.state

        if (observation.decision?.kind === 'advance-hint') {
          activateReviewHint(observation.decision)
        } else if (
          observation.state.maxLevelReached !== null &&
          previousForcedRevealKey !==
            observation.state.forcedRevealPositions.join(',')
        ) {
          // A position can reach its second lifetime error before the current
          // Hint level itself has accumulated two failures. Refresh the same
          // level immediately so that forced-reveal semantics are not delayed.
          const hintPlan = createReviewHintPlan(
            observation.state.maxLevelReached,
            targetLengthRef.current,
            observation.state.hintPosition ?? 0,
            observation.state.forcedRevealPositions,
          )
          exerciseConditionRef.current = hintPlan.condition
          reviewPolicyDecisionRef.current = hintPlan.decision
        }
      }

      setWordState((state) => {
        state.letterStates[inputLength - 1] = 'wrong'
        state.hasWrong = true
        state.hasMadeInputWrong = true
        state.wrongCount += 1
        state.letterTimeArray = []

        if (state.letterMistake[inputLength - 1]) {
          state.letterMistake[inputLength - 1].push(inputChar)
        } else {
          state.letterMistake[inputLength - 1] = [inputChar]
        }

        const currentState = JSON.parse(JSON.stringify(state))
        dispatch({ type: TypingStateActionType.REPORT_WRONG_WORD, payload: { letterMistake: currentState.letterMistake } })
      })

      if (currentChapter === 0 && state.chapterData.index === 0 && wordState.wrongCount >= 3) {
        setShowTipAlert(true)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordState.inputWord])

  useEffect(() => {
    if (wordState.hasWrong) {
      const timer = setTimeout(() => {
        acceptedInputLengthRef.current = 0
        inputLockedRef.current = false
        automaticPronunciationPlayedRef.current = false
        setWordState((state) => {
          state.inputWord = ''
          state.letterStates = new Array(state.letterStates.length).fill('normal')
          state.hasWrong = false
        })
        telemetryCollectorRef.current.startNextAttempt(Date.now())
      }, 300)

      return () => {
        clearTimeout(timer)
      }
    }
  }, [wordState.hasWrong, setWordState])

  useEffect(() => {
    if (wordState.isFinished && !finishNotifiedRef.current) {
      finishNotifiedRef.current = true
      dispatch({
        type: TypingStateActionType.SET_IS_SAVING_RECORD,
        payload: true,
      })

      const telemetry = telemetryCollectorRef.current.snapshot()
      const learningContext = learningContextCollectorRef.current.snapshot()
      const classification = classifyTypingError({
        word: word.name,
        wrongCount: wordState.wrongCount,
        telemetry,
        learningContext,
        history: historySummaryRef.current,
      })
      const reviewEvidence = evaluateReviewEvidence(
        {
          typingTelemetry: telemetry,
          learningContext,
          exerciseCondition: exerciseConditionRef.current,
        },
        classification,
      )

      const currentRecordForPolicy: IWordRecord = {
        word: word.name,
        timeStamp: Math.floor(Date.now() / 1000),
        dict: currentDictInfo.id,
        chapter: currentChapter,
        timing: [],
        wrongCount: wordState.wrongCount,
        mistakes: wordState.letterMistake,
        typingTelemetry: telemetry,
        learningContext,
        exerciseCondition: exerciseConditionRef.current,
        reviewPolicyDecision: reviewPolicyDecisionRef.current,
        reviewEvidence,
        sourceMode: currentChapter === -1 ? 'learn' : 'typing',
        learnItemKind:
          currentChapter === -1 ? learnItemKind ?? 'review' : undefined,
      }
      const nextExerciseShadow = exerciseConditionRef.current
        ? chooseNextExerciseShadow({
            baselineCondition: exerciseConditionRef.current,
            word: word.name,
            records: [
              ...historyRecordsRef.current,
              currentRecordForPolicy,
            ],
          })
        : null
      const isLearnAttempt = currentChapter === -1
      const isAcquisitionAttempt =
        isLearnAttempt && learnItemKind === 'acquisition'

      const notifyFinished = () => {
        onFinish({
          wrongCount: wordState.wrongCount,
          classification,
          nextExerciseShadow,
        })
      }

      const persistResult = async () => {
        let reviewProgressReleased = false

        try {
          const wordRecordId = await saveWordRecord({
            word: word.name,
            wrongCount: wordState.wrongCount,
            letterTimeArray: wordState.letterTimeArray,
            letterMistake: wordState.letterMistake,
            telemetry,
            learningContext,
            exerciseCondition: exerciseConditionRef.current,
            reviewPolicyDecision: reviewPolicyDecisionRef.current,
            reviewEvidence,
            reviewPolicyShadow: nextExerciseShadow ?? undefined,
            sourceMode: isLearnAttempt ? 'learn' : 'typing',
            learnItemKind: isLearnAttempt
              ? learnItemKind ?? 'review'
              : undefined,
          })

          if (isLearnAttempt) {
            // Raw evidence is the SSOT. Once it is durably captured, UI
            // progression must not wait for derived Learn-state persistence.
            dispatch({
              type: TypingStateActionType.SET_IS_SAVING_RECORD,
              payload: false,
            })
            reviewProgressReleased = true
            notifyFinished()

            if (wordRecordId > 0) {
              const now = Math.floor(Date.now() / 1000)
              const persistLearnState = isAcquisitionAttempt
                ? completeLearningAcquisition(
                    currentDictInfo.id,
                    word.name,
                    now,
                  )
                : applyReviewOutcome(
                    currentDictInfo.id,
                    word.name,
                    reviewOutcomeForAttempt({
                      classification,
                      evidence: reviewEvidence,
                      condition: exerciseConditionRef.current,
                    }),
                    now,
                    wordRecordId,
                  )

              void persistLearnState.catch((error) => {
                console.error(
                  isAcquisitionAttempt
                    ? 'failed to persist acquisition learning state'
                    : 'failed to persist derived review scheduler state',
                  error,
                )
              })
            }
            return
          }

          // Typing is deliberately long-term-state neutral. Its WordRecord is
          // retained as prior evidence; Learn may reactivate a state later
          // during explicit Learn admission/bootstrap.
        } catch (error) {
          console.error('failed to persist review learning state', error)
        } finally {
          if (isLearnAttempt) {
            if (!reviewProgressReleased) {
              dispatch({
                type: TypingStateActionType.SET_IS_SAVING_RECORD,
                payload: false,
              })
              notifyFinished()
            }
          } else {
            dispatch({
              type: TypingStateActionType.SET_IS_SAVING_RECORD,
              payload: false,
            })
            notifyFinished()
          }
        }
      }

      void persistResult()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wordState.isFinished])

  useEffect(() => {
    if (wordState.wrongCount >= 4) {
      dispatch({ type: TypingStateActionType.SET_IS_SKIP, payload: true })
    }
  }, [wordState.wrongCount, dispatch])

  return (
    <>
      <InputHandler updateInput={updateInput} />
      <div
        lang={currentLanguageCategory !== 'code' ? currentLanguageCategory : 'en'}
        className="flex flex-col items-center justify-center pb-1 pt-4"
      >
        {['romaji', 'hapin'].includes(currentLanguage) && word.notation && <Notation notation={word.notation} />}
        <div
          className={`tooltip-info relative w-fit bg-transparent p-0 leading-normal shadow-none dark:bg-transparent ${
            wordDictationConfig.isOpen ? 'tooltip' : ''
          }`}
          data-tip="按 Tab 快捷键显示完整单词"
        >
          <div
            data-typing-word={word.name}
            data-typing-input={wordState.inputWord}
            data-typing-accepted-length={acceptedInputLengthRef.current}
            data-typing-target-length={targetLengthRef.current}
            data-typing-locked={inputLockedRef.current ? 'true' : 'false'}
            data-typing-has-wrong={wordState.hasWrong ? 'true' : 'false'}
            data-typing-finished={wordState.isFinished ? 'true' : 'false'}
            data-typing-active={state.isTyping ? 'true' : 'false'}
            data-review-purpose={exerciseConditionRef.current?.purpose}
            data-review-probe-dimension={exerciseConditionRef.current?.probeDimension}
            data-review-audio={exerciseConditionRef.current?.audio}
            data-review-meaning={exerciseConditionRef.current?.meaning}
            data-review-phonetic={exerciseConditionRef.current?.phonetic}
            data-review-letters={exerciseConditionRef.current?.letters.mode}
            data-review-policy={reviewPolicyDecisionRef.current?.policyVersion}
            data-review-hint-level={activeHintLevel === null ? 'cold' : activeHintLevel}
            data-review-hint-stage={reviewHintStateRef.current.stage}
            data-review-hint-position={
              reviewHintStateRef.current.hintPosition ?? ''
            }
            data-review-hint-auto={
              learningContextCollectorRef.current.snapshot().reviewHint
                ?.autoHint0Triggered
                ? 'true'
                : 'false'
            }
            data-review-hint-stage-errors={
              reviewHintStateRef.current.stageWrongCount
            }
            data-review-forced-reveal={
              reviewHintStateRef.current.forcedRevealPositions.join(',')
            }
            data-review-skip-locked={state.isSkipLocked ? 'true' : 'false'}
            onMouseEnter={() => handleHoverWord(true)}
            onMouseLeave={() => handleHoverWord(false)}
            className={`flex items-center ${isTextSelectable && 'select-all'} justify-center ${wordState.hasWrong ? style.wrong : ''}`}
          >
            {wordState.displayWord.split('').map((t, index) => {
              const hintEmphasis =
                activeHintLevel !== null &&
                activeHintLevel < 3 &&
                (reviewHintStateRef.current.hintPosition === index ||
                  reviewHintStateRef.current.forcedRevealPositions.includes(
                    index,
                  ))
              return (
                <Letter
                  key={`${index}-${t}`}
                  letter={t}
                  visible={getLetterVisible(index)}
                  state={wordState.letterStates[index]}
                  hintEmphasis={hintEmphasis}
                />
              )
            })}
          </div>
          {(pronunciationIsOpen || (activeHintLevel !== null && activeHintLevel >= 1)) && (
            <div
              className="absolute -right-12 top-1/2 h-9 w-9 -translate-y-1/2 transform "
              onClickCapture={() => learningContextCollectorRef.current.recordPronunciationPlayed('requested')}
            >
              <Tooltip content={`快捷键${CTRL} + J`}>
                <WordPronunciationIcon word={word} lang={currentLanguage} ref={wordPronunciationIconRef} className="h-full w-full" />
              </Tooltip>
            </div>
          )}
        </div>
        {isManagedReviewHintFlow() && (
          <div
            className="mt-3 text-center text-xs text-gray-400 dark:text-gray-500"
            data-review-hint-help
          >
            {activeHintLevel === 3
              ? '请照着完整单词输入正确后继续'
              : activeHintLevel === null
                ? '同一位置拼错两次会自动提示该字母；也可在输入开头按空格获取提示'
                : '当前提示下错两次会自动升级；也可在输入开头按空格获取下一提示'}
          </div>
        )}
      </div>
      <TipAlert className="fixed bottom-10 right-3" show={showTipAlert} setShow={setShowTipAlert} />
    </>
  )
}
