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
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import { classifyTypingError } from '@/review/classifier'
import type { TypingErrorClassification } from '@/review/classifier'
import {
  createBaselineExerciseCondition,
  isLetterVisibleForExerciseCondition,
} from '@/review/condition'
import type { ExerciseConditionV1 } from '@/review/condition'
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
  LearningContextCollector,
  calculateAnswerVisibleRatio,
  summarizeAnswerVisibility,
} from '@/review/learning-context'
import {
  decideWordInput,
  shouldPlayAutomaticPronunciation,
} from '@/review/machine'
import { applyReviewOutcome } from '@/review/repository'
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
}

export default function WordComponent({
  word,
  onFinish,
  meaningVisible,
  phoneticVisible,
  exercisePlan,
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

  useLayoutEffect(() => {
    // Resolve the frozen presentation before paint / first input.
    telemetryCollectorRef.current.resetWord()
    acceptedInputLengthRef.current = 0
    inputLockedRef.current = false
    automaticPronunciationPlayedRef.current = false
    finishNotifiedRef.current = false

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

  const updateInput = useCallback(
    (updateAction: WordUpdateAction) => {
      switch (updateAction.type) {
        case 'add': {
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
    [wordState.hasWrong, setWordState],
  )

  const handleHoverWord = useCallback(
    (checked: boolean) => {
      if (checked && isShowAnswerOnHover && wordDictationConfig.isOpen) {
        learningContextCollectorRef.current.recordAnswerReveal(Date.now())
      }
      setIsHoveringWord(checked)
    },
    [isShowAnswerOnHover, wordDictationConfig.isOpen],
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
  }, [playPronunciation, state.isTyping, wordState.inputWord.length])

  const getLetterVisible = useCallback(
    (index: number) => {
      if (wordState.letterStates[index] === 'correct' || (isShowAnswerOnHover && isHoveringWord)) return true

      const activeCondition = exerciseConditionRef.current
      if (
        activeCondition?.source === 'adaptive-policy' &&
        activeCondition.letters.mode === 'targeted-mask'
      ) {
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
      telemetryCollectorRef.current.recordWrong(inputLength - 1, inputLength - 1, inputChar, Date.now())
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
      const isReviewAttempt = currentChapter === -1

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
          })

          if (isReviewAttempt) {
            // Raw evidence is the SSOT. Once it is durably captured, UI
            // progression must not wait for derived scheduler persistence.
            dispatch({
              type: TypingStateActionType.SET_IS_SAVING_RECORD,
              payload: false,
            })
            reviewProgressReleased = true
            notifyFinished()

            if (wordRecordId > 0) {
              void applyReviewOutcome(
                currentDictInfo.id,
                word.name,
                reviewOutcomeForAttempt({
                  classification,
                  evidence: reviewEvidence,
                  condition: exerciseConditionRef.current,
                }),
                Math.floor(Date.now() / 1000),
                wordRecordId,
              ).catch((error) => {
                console.error(
                  'failed to persist derived review scheduler state',
                  error,
                )
              })
            }
            return
          }

          if (wordRecordId > 0) {
            await applyReviewOutcome(
              currentDictInfo.id,
              word.name,
              reviewOutcomeForAttempt({
                classification,
                evidence: reviewEvidence,
                condition: exerciseConditionRef.current,
              }),
              Math.floor(Date.now() / 1000),
              wordRecordId,
            )
          }
        } catch (error) {
          console.error('failed to persist review learning state', error)
        } finally {
          if (isReviewAttempt) {
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
            onMouseEnter={() => handleHoverWord(true)}
            onMouseLeave={() => handleHoverWord(false)}
            className={`flex items-center ${isTextSelectable && 'select-all'} justify-center ${wordState.hasWrong ? style.wrong : ''}`}
          >
            {wordState.displayWord.split('').map((t, index) => {
              return <Letter key={`${index}-${t}`} letter={t} visible={getLetterVisible(index)} state={wordState.letterStates[index]} />
            })}
          </div>
          {pronunciationIsOpen && (
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
      </div>
      <TipAlert className="fixed bottom-10 right-3" show={showTipAlert} setShow={setShowTipAlert} />
    </>
  )
}
