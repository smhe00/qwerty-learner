import type { WordFinishResult } from './Word'
import { generateWordSoundSrc } from '@/hooks/usePronunciation'
import { createLearnAcquisitionExercisePlanForState } from '@/learn/acquisition'
import type { LearnAcquisitionState } from '@/learn/acquisition'
import { trackLearnPersistence } from '@/learn/persistence'
import type { LearnItemKind } from '@/learn/session'
import { selectLearnTask } from '@/learn/task-selector'
import type { LearnExerciseKind, LearnExercisePreference, LearnTaskHistoryEvent } from '@/learn/task-selector'
import { useMobileKeyboardIntent } from '@/pages/Typing/hooks/useMobileKeyboardIntent'
import { useMobileWordAudio } from '@/pages/Typing/hooks/useMobileWordAudio'
import { useSessionKeyboard } from '@/pages/Typing/hooks/useSessionKeyboard'
import { useTapRecallKeyboard } from '@/pages/Typing/hooks/useTapRecallKeyboard'
import { mobileLearnInputAtom } from '@/pages/Typing/store/mobileLearnInput'
import { useMobilePracticeDraft } from '@/pages/Typing/store/mobilePracticeDraft'
import type { PendingRecallAttempt } from '@/pages/Typing/store/mobilePracticeDraft'
import type { TypingErrorClassification } from '@/review/classifier'
import type { ExerciseConditionV1 } from '@/review/condition'
import { createCanonicalReviewProbePlan, createReviewPolicyDecision } from '@/review/decision'
import type { ReviewExercisePlanV1, ReviewPolicyDecisionV1 } from '@/review/decision'
import type { ReviewEvidenceV1 } from '@/review/evidence'
import { scheduleLearnReviewCommit } from '@/review/learn-review-commit'
import { decideReviewRating } from '@/review/state-machine'
import type { RatingDecision, ReviewAttemptRole } from '@/review/state-machine'
import type { ReviewOutcome } from '@/review/types'
import { currentDictInfoAtom, pronunciationConfigAtom } from '@/store'
import type { Word } from '@/typings'
import { useSaveWordRecord } from '@/utils/db'
import { db } from '@/utils/db/core'
import type { IWordRecord, LearningContextV1 } from '@/utils/db/record'
import { getFirstValidDictionaryExample, maskDictionaryExample } from '@/utils/dictionaryExample'
import { getUTCUnixTimestamp } from '@/utils/time'
import { useAtom, useAtomValue } from 'jotai'
import { Hand, Headphones, Keyboard, Volume2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type MobileTask = LearnExerciseKind
type MobileWordPracticeProps = {
  word: Word
  queue: Word[]
  onFinish: (result: WordFinishResult) => void | Promise<void>
  resumeKey?: string
  exercisePlan?: ReviewExercisePlanV1
  itemKind: LearnItemKind
  recordKind: LearnItemKind
  acquisitionState?: LearnAcquisitionState
  reviewAttemptRole?: ReviewAttemptRole
  exercisePreference?: LearnExercisePreference
  desktop?: boolean
  paused: boolean
  onResume: () => void
  onTogglePause: () => void
}

const RECALL_GRADES: Array<{ rating: ReviewOutcome; label: string }> = [
  { rating: 'again', label: '忘了' },
  { rating: 'hard', label: '模糊' },
  { rating: 'good', label: '记得' },
]

function stableKey(value: string): number {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function classificationFor(cause: TypingErrorClassification['cause']): TypingErrorClassification {
  return {
    cause,
    confidence: cause === 'uncertain' ? 0.75 : 1,
    scores:
      cause === 'recall'
        ? { recall: 1, spelling: 0, motor: 0 }
        : cause === 'spelling'
        ? { recall: 0, spelling: 1, motor: 0 }
        : cause === 'uncertain'
        ? { recall: 1 / 3, spelling: 1 / 3, motor: 1 / 3 }
        : { recall: 0, spelling: 0, motor: 0 },
  }
}

function conditionForTask(task: MobileTask, isCoreRecall: boolean, plan?: ReviewExercisePlanV1): ExerciseConditionV1 {
  if (task === 'exposure' && plan) return plan.condition
  if ((task === 'recall' || task === 'spelling') && isCoreRecall && plan) return plan.condition
  return {
    version: 1,
    purpose: 'training',
    source: 'adaptive-policy',
    audio: task === 'audio' ? 'automatic' : 'none',
    meaning: task === 'meaning-choice' || task === 'recall' || task === 'spelling' ? 'visible' : 'hidden',
    phonetic: task === 'exposure' ? 'visible' : 'hidden',
    letters: { mode: task === 'recall' || task === 'spelling' ? 'all-hidden' : 'all-visible' },
    probeDimension: task === 'audio' ? 'audio' : task === 'recall' || task === 'spelling' ? 'none' : 'meaning',
  }
}

function learningContextForTask(task: MobileTask, hasExample: boolean, audioPlayed: boolean, manuallyPlayed: boolean): LearningContextV1 {
  const hidden = task === 'recall' || task === 'spelling'
  return {
    version: 1,
    answerVisibilityAtStart: hidden ? 'hidden' : 'full',
    answerVisibleRatioAtStart: hidden ? 0 : 1,
    answerRevealed: false,
    revealedBeforeFirstKey: false,
    revealCount: 0,
    exampleVisibleAtStart: hasExample && (task === 'exposure' || task === 'context' || task === 'recall' || task === 'spelling'),
    meaningVisibleAtStart: task === 'exposure' || task === 'recall' || task === 'spelling' || task === 'meaning-choice',
    meaningRevealed: false,
    meaningRevealedBeforeFirstKey: false,
    meaningRevealCount: 0,
    phoneticVisibleAtStart: task === 'exposure',
    pronunciationEnabledAtStart: task === 'exposure' || task === 'audio',
    pronunciationPlayed: audioPlayed,
    pronunciationPlayedBeforeFirstKey: audioPlayed,
    pronunciationPlayCount: audioPlayed ? 1 : 0,
    pronunciationAutomaticPlayCount: audioPlayed && !manuallyPlayed ? 1 : 0,
    pronunciationRequestedPlayCount: manuallyPlayed ? 1 : 0,
  }
}

export default function MobileWordPractice({
  word,
  queue,
  onFinish,
  exercisePlan,
  itemKind,
  recordKind,
  acquisitionState,
  reviewAttemptRole,
  resumeKey,
  exercisePreference = 'auto',
  desktop = false,
  paused,
  onResume,
  onTogglePause,
}: MobileWordPracticeProps) {
  const [mobileInput, setMobileInput] = useAtom(mobileLearnInputAtom)
  const keyboardControls = desktop || mobileInput.keyboardUsed
  const dict = useAtomValue(currentDictInfoAtom)
  const pronunciation = useAtomValue(pronunciationConfigAtom)
  const saveWordRecord = useSaveWordRecord()
  const draft = useMobilePracticeDraft(resumeKey)
  const {
    revealedAttempt,
    feedback,
    isSaving,
    manualExercise,
    pendingSpelling,
    spellingInput,
    error,
    setRevealedAttempt,
    setFeedback,
    setIsSaving,
    setManualExercise,
    setPendingSpelling,
    setSpellingInput,
    setError,
    setFrozenTask,
    discard: discardDraft,
  } = draft
  const [taskHistory, setTaskHistory] = useState<LearnTaskHistoryEvent[]>([])
  const composingRef = useRef(false)
  const [audioFallback, setAudioFallback] = useState(false)
  const submittingRef = useRef(false)
  const finishedRef = useRef(false)
  const surfaceRef = useRef<HTMLElement>(null)
  const spellingInputRef = useRef<HTMLInputElement>(null)
  useTapRecallKeyboard(surfaceRef, keyboardControls && !paused && !isSaving)
  useSessionKeyboard({ active: !paused, disabled: desktop || !mobileInput.keyboardUsed, onToggle: onTogglePause })
  // Once an answer or decision exists, pin this card's presentation. A keyboard
  // signal may prefer spelling for the NEXT card without changing this one.
  const mobilePreference = useRef(mobileInput.preference)
  if (!revealedAttempt && !feedback && !pendingSpelling && !isSaving) {
    mobilePreference.current = mobileInput.preference
  }

  const shortcut = (key: string, alias?: string) =>
    keyboardControls
      ? {
          'data-desktop-shortcut': key.toLowerCase() + (alias ? ' ' + alias : ''),
          'aria-keyshortcuts': key === 'Space' ? 'Space' : key.toUpperCase() + (alias ? ' ' + alias : ''),
        }
      : {}
  const keyHint = (key: string) =>
    keyboardControls ? (
      <kbd className="desktop-tap-key" aria-hidden="true">
        {key}
      </kbd>
    ) : null

  // Read-only historical evidence. Selection never changes the FSRS event or
  // the word allotted by the shared Learn session.
  useEffect(() => {
    let active = true
    void db.wordRecords
      .where('word')
      .equals(word.name)
      .filter((row) => row.dict === dict.id && row.sourceMode === 'learn')
      .toArray()
      .then((rows) => {
        if (active && !submittingRef.current) setTaskHistory(rows)
      })
      .catch((reason) => console.warn('Study task history unavailable, using recall fallback', reason))
    return () => {
      active = false
    }
  }, [word.name, dict.id])

  const example = useMemo(() => getFirstValidDictionaryExample(word), [word])
  const maskedExample = example ? maskDictionaryExample(example) : null
  const meanings = word.trans?.filter(Boolean).join('；') || '暂无释义'
  const exampleFontSize =
    example && example.en.length > 205
      ? 'clamp(11px, 2.9vw, 13px)'
      : example && example.en.length > 140
      ? 'clamp(12px, 3.2vw, 14px)'
      : example && example.en.length > 88
      ? 'clamp(13px, 3.5vw, 15px)'
      : 'clamp(15px, 4.2vw, 18px)'

  // The dictionary's validated start/end coordinates identify the target
  // surface exactly. A cold recall or cloze task highlights ONLY its mask,
  // never the answer; reveal and exposure highlight the actual target.
  const renderExample = (showAnswer: boolean) => {
    if (!maskedExample) return null
    return (
      <p className="mobile-practice-example" style={{ fontSize: exampleFontSize }} data-mobile-example>
        {maskedExample.before}
        <mark className={showAnswer ? 'mobile-practice-keyword' : 'mobile-practice-blank'} data-mobile-keyword>
          {showAnswer ? maskedExample.surface : maskedExample.masked}
        </mark>
        {maskedExample.after}
      </p>
    )
  }
  const choices = useMemo(() => {
    const seen = new Set<string>()
    const targetMeaning = word.trans?.filter(Boolean).join('；')
    const candidates = queue.filter((candidate) => {
      if (!candidate.name || candidate.name === word.name || seen.has(candidate.name)) return false
      seen.add(candidate.name)
      return true
    })
    const differentMeanings = candidates.filter((candidate) => candidate.trans?.filter(Boolean).join('；') !== targetMeaning)
    const distractors = (differentMeanings.length >= 3 ? differentMeanings : candidates)
      .sort((a, b) => stableKey(a.name) - stableKey(b.name))
      .slice(0, 3)
    return [...distractors, word].sort((a, b) => stableKey(a.name) - stableKey(b.name))
  }, [queue, word])

  const phase = itemKind === 'acquisition' ? acquisitionState?.phase : undefined
  const selection = selectLearnTask({
    itemKind,
    acquisitionPhase: phase,
    hasContext: Boolean(maskedExample),
    choicesAvailable: choices.length > 1,
    audioAvailable: !audioFallback,
    goal: 'vocabulary-and-spelling',
    preference: manualExercise ?? (desktop ? exercisePreference : mobilePreference.current),
    hasTextInput: true,
    history: taskHistory,
  })
  const task: MobileTask = draft.frozenTask ?? selection.exercise

  useEffect(() => {
    if (
      (desktop || mobileInput.keyboardUsed || mobileInput.preference === 'cold-spelling' || manualExercise === 'cold-spelling') &&
      task === 'spelling' &&
      !paused &&
      !pendingSpelling &&
      !feedback
    ) {
      spellingInputRef.current?.focus()
    }
  }, [desktop, mobileInput.keyboardUsed, mobileInput.preference, manualExercise, task, paused, pendingSpelling, feedback])

  useMobileKeyboardIntent(!desktop, (key) => {
    if (mobileInput.keyboardUsed && (key === 'Enter' || paused)) return false
    if (paused) {
      setMobileInput((old) => ({ ...old, keyboardUsed: true }))
      onResume()
      return true
    }
    if (key === 'Enter') {
      setMobileInput((old) => ({ ...old, keyboardUsed: true }))
      onTogglePause()
      return true
    }
    // An explicit touch preference wins over automatic spelling adoption.
    if (mobileInput.preference === 'tap-recall') {
      if (mobileInput.keyboardUsed) return false
      setMobileInput((old) => ({ ...old, keyboardUsed: true }))
      return true
    }
    const canEnterSpelling =
      (task === 'spelling' || (task === 'recall' && (itemKind === 'review' || phase === 'independent'))) &&
      !revealedAttempt &&
      !feedback &&
      !pendingSpelling &&
      !isSaving &&
      !submittingRef.current
    if (mobileInput.keyboardUsed && !canEnterSpelling) return false
    setMobileInput({ preference: 'cold-spelling', keyboardUsed: true })
    if (canEnterSpelling) {
      setManualExercise('cold-spelling')
      setSpellingInput((old) => old + key)
      spellingInputRef.current?.focus()
    }
    // Exposure/feedback keeps its current task; only the next cold card adopts.
    return true
  })

  const isCoreRecall = itemKind === 'review' || (itemKind === 'acquisition' && phase === 'independent')
  // Phone-only Acquisition must obey the SAME Independent admission plan as
  // desktop spelling. Never silently substitute the Review canonical policy:
  // that would save a Good self-report but prevent this new word's admission.
  const activePlan =
    exercisePlan ??
    (itemKind === 'acquisition' && acquisitionState && acquisitionState.phase !== 'complete' && acquisitionState.phase !== 'deferred'
      ? createLearnAcquisitionExercisePlanForState(acquisitionState)
      : isCoreRecall
      ? createCanonicalReviewProbePlan()
      : undefined)
  const wantsAutomaticSound = task === 'audio' || task === 'exposure'
  const source = generateWordSoundSrc(word.name, pronunciation.type || 'uk')

  const { audioState, audioPlayed, manualAudioPlayed, playSound } = useMobileWordAudio({
    source,
    volume: pronunciation.volume,
    rate: pronunciation.rate,
    paused,
    automatic: wantsAutomaticSound && !feedback,
  })

  const getCondition = (mode: MobileTask) => conditionForTask(mode, isCoreRecall, activePlan)
  const getPolicy = (condition: ExerciseConditionV1, mode: MobileTask): ReviewPolicyDecisionV1 =>
    activePlan
      ? condition === activePlan.condition
        ? activePlan.decision
        : createReviewPolicyDecision(
            activePlan.decision.policyVersion,
            [...activePlan.decision.reasonCodes, 'mobile-task-' + mode],
            condition.version,
          )
      : createReviewPolicyDecision('mobile-multidimensional-learning-v1', ['mobile-task-' + mode], condition.version)

  const makeEvidence = (
    mode: MobileTask,
    grade: ReviewOutcome,
    wrongCount: number,
    condition: ExerciseConditionV1,
    adjudicatedCause?: 'spelling' | 'recall',
  ) => {
    const cause: TypingErrorClassification['cause'] =
      adjudicatedCause ?? (wrongCount > 0 ? 'recall' : grade === 'hard' ? 'uncertain' : 'clean')
    const classification = classificationFor(cause)
    const independent = (mode === 'recall' || mode === 'spelling') && isCoreRecall
    const evidence: ReviewEvidenceV1 = {
      version: 1,
      memoryGrade: grade,
      errorCause: cause,
      confidence: classification.confidence,
      evidenceStrength: grade === 'hard' ? 0.65 : 1,
      retrievalValidity: independent ? 'independent' : 'assisted',
      reasonCodes: [
        'mobile-multidimensional-learning',
        'mobile-task-' + mode,
        independent ? 'independent-retrieval' : 'assisted-practice',
        ...(mode === 'recall'
          ? ['self-report-not-spelling', 'self-rated-before-answer-reveal']
          : mode === 'spelling'
          ? [
              wrongCount === 0 ? 'objective-spelling-clean' : 'objective-spelling-mismatch',
              'typed-with-answer-hidden',
              ...(adjudicatedCause === 'spelling' ? ['learner-confirmed-recalled-but-misspelled'] : []),
            ]
          : ['recognition-or-training-evidence']),
        ...(mode === 'audio' && !audioPlayed ? ['audio-cue-not-played'] : []),
        mode === 'recall' ? 'self-rated-' + grade : mode === 'spelling' ? 'objectively-checked-' + grade : 'choice-graded-' + grade,
      ],
    }
    let reviewRatingDecision: RatingDecision | undefined
    if (itemKind === 'review' && reviewAttemptRole && (mode === 'recall' || mode === 'spelling')) {
      reviewRatingDecision = decideReviewRating({
        attemptRole: reviewAttemptRole,
        condition,
        classification,
        evidence,
      })
    }
    return { classification, evidence, reviewRatingDecision }
  }

  const saveAttempt = async (input: {
    mode: MobileTask
    grade: ReviewOutcome
    wrongCount: number
    title: string
    frozen?: PendingRecallAttempt
    adjudicatedCause?: 'spelling' | 'recall'
    submittedSpelling?: string
  }) => {
    if (paused || isSaving || submittingRef.current || feedback) return
    submittingRef.current = true
    setFrozenTask(input.mode)
    setIsSaving(true)
    setError('')
    const condition = input.frozen?.condition ?? getCondition(input.mode)
    const context =
      input.frozen?.learningContext ?? learningContextForTask(input.mode, Boolean(maskedExample), audioPlayed, manualAudioPlayed)
    const policyDecision = input.frozen?.policyDecision ?? getPolicy(condition, input.mode)
    const { classification, evidence, reviewRatingDecision } = makeEvidence(
      input.mode,
      input.grade,
      input.wrongCount,
      condition,
      input.adjudicatedCause,
    )
    const mistakes: Record<number, string[]> = {}
    if (input.mode === 'spelling' && input.wrongCount > 0 && input.submittedSpelling) {
      const submitted = input.submittedSpelling.toLowerCase()
      const correct = word.name.toLowerCase()
      const submittedChars = Array.from(submitted)
      const firstDifferent = Array.from(correct).findIndex((ch, i) => submittedChars[i] !== ch)
      // Trailing extra characters have no corresponding target letter:
      // preserve the failed event without inventing a positional mistake.
      if (firstDifferent >= 0) {
        mistakes[firstDifferent] = [submittedChars[firstDifferent] ?? '∅']
      }
    }
    const record: IWordRecord = {
      word: word.name,
      timeStamp: getUTCUnixTimestamp(),
      dict: dict.id,
      chapter: -1,
      timing: [],
      wrongCount: input.wrongCount,
      mistakes,
      learningContext: context,
      exerciseCondition: condition,
      reviewPolicyDecision: policyDecision,
      reviewEvidence: evidence,
      reviewRatingDecision,
      sourceMode: 'learn',
      learnItemKind: recordKind,
    }
    try {
      const id = await trackLearnPersistence(
        saveWordRecord({
          word: word.name,
          wrongCount: input.wrongCount,
          letterTimeArray: [],
          letterMistake: mistakes,
          learningContext: context,
          exerciseCondition: condition,
          reviewPolicyDecision: policyDecision,
          reviewEvidence: evidence,
          reviewRatingDecision,
          sourceMode: 'learn',
          learnItemKind: recordKind,
        }),
      )
      if (id <= 0) throw new Error('学习记录保存失败，本词尚未推进。')
      record.id = id
      scheduleLearnReviewCommit({
        dict: dict.id,
        word: word.name,
        itemKind: recordKind,
        wordRecordId: id,
        decision: reviewRatingDecision,
      })
      setFeedback({
        result: { record, wrongCount: input.wrongCount, classification, reviewRatingDecision, reviewEvidence: evidence },
        autoAdvance: input.grade === 'good' && input.wrongCount === 0,
        title: input.title,
      })
      setRevealedAttempt(null)
    } catch (reason) {
      submittingRef.current = false
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setIsSaving(false)
    }
  }

  const rateRecall = (grade: ReviewOutcome) => {
    if (paused || feedback || revealedAttempt || isSaving) return
    // Freeze ALL cold-probe conditions at the decision moment, before the
    // English answer is exposed. This is a self-report, NOT spelling proof.
    const condition = getCondition('recall')
    const frozen: PendingRecallAttempt = {
      grade,
      condition,
      learningContext: learningContextForTask('recall', Boolean(maskedExample), false, false),
      policyDecision: getPolicy(condition, 'recall'),
    }
    setFrozenTask('recall')
    setRevealedAttempt(frozen)
    if (grade !== 'good') {
      void saveAttempt({
        mode: 'recall',
        grade,
        wrongCount: grade === 'again' ? 1 : 0,
        title: grade === 'again' ? '还需要巩固' : '已标记为模糊',
        frozen,
      })
    }
    // Good waits for a short verification window; if the user recognizes a
    // mismatch in the revealed answer, one tap downgrades this attempt.
  }

  const correctRecall = () => {
    if (!revealedAttempt || revealedAttempt.grade !== 'good' || isSaving || feedback) return
    void saveAttempt({
      mode: 'recall',
      grade: 'again',
      wrongCount: 1,
      title: '已纠正为忘了',
      frozen: revealedAttempt,
    })
  }

  // Capture and hold the pending Good until the user has had time to inspect
  // the answer. On pause, the timer is cancelled and restarts on resume.
  // Abandoning the page before submission does not write a false Good.
  const saveAttemptRef = useRef(saveAttempt)
  saveAttemptRef.current = saveAttempt
  useEffect(() => {
    if (!revealedAttempt || revealedAttempt.grade !== 'good' || paused || feedback || error) return
    const timeout = window.setTimeout(() => {
      void saveAttemptRef.current({
        mode: 'recall',
        grade: 'good',
        wrongCount: 0,
        title: '记住了（自评）',
        frozen: revealedAttempt,
      })
    }, 2600)
    return () => window.clearTimeout(timeout)
  }, [revealedAttempt, paused, feedback, error])

  const submitSpelling = () => {
    if (task !== 'spelling' || isSaving || paused || feedback || pendingSpelling) return
    const attempted = spellingInput.trim().normalize('NFKC')
    if (!attempted) return
    const expected = word.name.trim().normalize('NFKC')
    if (attempted.toLocaleLowerCase() === expected.toLocaleLowerCase()) {
      void saveAttempt({
        mode: 'spelling',
        grade: 'good',
        wrongCount: 0,
        title: '独立拼写正确',
      })
    } else {
      // Hold the WRONG answer without revealing the target. Only the learner
      // can distinguish a remembered word with a typo from a true recall
      // failure. Never guess a memory failure from edit distance.
      setFrozenTask('spelling')
      setPendingSpelling(attempted)
    }
  }

  const resolveSpellingMismatch = (memoryWasIntact: boolean) => {
    if (!pendingSpelling || submittingRef.current || paused || feedback) return
    void saveAttempt({
      mode: 'spelling',
      grade: memoryWasIntact ? 'hard' : 'again',
      wrongCount: 1,
      adjudicatedCause: memoryWasIntact ? 'spelling' : 'recall',
      submittedSpelling: pendingSpelling,
      title: memoryWasIntact ? '记住了词义，拼写需巩固' : '暂时忘了 · 继续巩固',
    })
  }

  const choose = (name: string) => {
    if (task === 'audio' && !audioPlayed) return
    const correct = name === word.name
    void saveAttempt({
      mode: task,
      grade: correct ? 'good' : 'again',
      wrongCount: correct ? 0 : 1,
      title: correct ? '答对了' : '再记一下这个词',
    })
  }

  const advanceAfterFeedback = useCallback(
    async (saved: NonNullable<typeof feedback>) => {
      if (paused || finishedRef.current) return
      finishedRef.current = true
      try {
        await onFinish(saved.result)
        discardDraft()
      } catch {
        finishedRef.current = false
        setError('本词结果已保存，但学习位置未能更新。请重试继续，不会重复提交答案。')
      }
    },
    [onFinish, paused, discardDraft, setError],
  )

  useEffect(() => {
    if (!feedback?.autoAdvance || paused || error) return
    // Full success: briefly acknowledge the saved answer, then proceed.
    // Wrong and uncertain answers remain visible until an explicit next tap.
    const timeout = window.setTimeout(() => void advanceAfterFeedback(feedback), 1000)
    return () => window.clearTimeout(timeout)
  }, [feedback, paused, error, advanceAfterFeedback])

  const playAgain = () => playSound(true)
  const title =
    task === 'spelling'
      ? '独立拼写'
      : task === 'exposure'
      ? '认识新词'
      : task === 'context'
      ? '语境选择'
      : task === 'audio'
      ? '听音辨词'
      : task === 'meaning-choice'
      ? '词义识别'
      : '主动回忆'
  const audioRequiresTap = task === 'audio' && !audioPlayed && audioState !== 'error'
  const audioFailed = task === 'audio' && audioState === 'error'

  // Reserve the top line for the complete orthographic answer. Long words
  // shrink before wrapping; neither examples nor definitions may push it away.
  const wordFontSize =
    word.name.length > 26
      ? 'clamp(17px, 4.7vw, 24px)'
      : word.name.length > 18
      ? 'clamp(19px, 6vw, 29px)'
      : word.name.length > 12
      ? 'clamp(23px, 7vw, 35px)'
      : 'clamp(29px, 8.4vw, 40px)'

  return (
    <section
      ref={surfaceRef}
      className="mobile-practice"
      data-desktop-tap-practice={desktop || undefined}
      data-mobile-keyboard-practice={(!desktop && mobileInput.keyboardUsed) || undefined}
      data-keyboard-practice={keyboardControls || undefined}
      data-mobile-word-practice
      data-mobile-task={task}
      data-mobile-audio-state={audioState}
      data-mobile-policy={activePlan?.decision.policyVersion ?? 'training'}
      data-mobile-selector={selection.reason}
      data-mobile-word={word.name}
      data-mobile-next-mode={feedback ? (feedback.autoAdvance ? 'auto' : 'manual') : 'pending'}
      data-mobile-recall-stage={task === 'recall' ? (feedback ? 'saved' : revealedAttempt ? 'verification' : 'unrevealed') : undefined}
      aria-label={desktop ? '轻触单词学习' : '手机单词学习'}
    >
      <header className="mobile-practice-head">
        <div className="mobile-practice-input-row">
          <span className="mobile-eyebrow">LEARN</span>
          {!desktop && (
            <button
              type="button"
              className="mobile-input-preference"
              data-mobile-input-preference={mobileInput.preference}
              aria-label={'学习方式：' + (mobileInput.preference === 'cold-spelling' ? '拼写' : '轻触')}
              title={mobileInput.preference === 'cold-spelling' ? '切换到轻触' : '切换到拼写'}
              disabled={paused || isSaving || Boolean(revealedAttempt || feedback || pendingSpelling)}
              onClick={(event) => {
                const preference = mobileInput.preference === 'cold-spelling' ? 'tap-recall' : 'cold-spelling'
                setManualExercise(null)
                setMobileInput((old) => ({ ...old, preference }))
                if (event.detail > 0) event.currentTarget.blur()
              }}
            >
              {mobileInput.preference === 'cold-spelling' ? (
                <Keyboard size={15} aria-hidden="true" />
              ) : (
                <Hand size={15} aria-hidden="true" />
              )}
              {mobileInput.preference === 'cold-spelling' ? '拼写' : '轻触'}
            </button>
          )}
        </div>
        {!desktop && (mobileInput.keyboardUsed || mobileInput.preference === 'cold-spelling') && (
          <p className="mobile-keyboard-hint" role="status" data-mobile-keyboard-hint>
            {mobileInput.preference === 'cold-spelling'
              ? task === 'spelling'
                ? mobileInput.keyboardUsed
                  ? '键盘输入 · Enter 确认拼写'
                  : '拼写模式 · 输入后确认'
                : '回忆阶段优先拼写'
              : '键盘操作可用 · 也可继续轻触'}
          </p>
        )}
        <div className="mobile-practice-title-row">
          <h1>{title}</h1>
          <span className="mobile-practice-step">{phase === 'independent' ? '独立回忆' : phase === 'supported' ? '巩固' : '学习中'}</span>
        </div>
      </header>

      <div className="mobile-practice-reading" data-mobile-reading>
        <div className="mobile-practice-word-slot" data-mobile-word-slot>
          {feedback ? (
            <>
              <p className="mobile-practice-feedback-status" data-mobile-feedback role="status">
                {feedback.title}
              </p>
              <h2 className="mobile-practice-word" style={{ fontSize: wordFontSize }}>
                {word.name}
              </h2>
            </>
          ) : task === 'exposure' ? (
            <>
              <h2 className="mobile-practice-word" style={{ fontSize: wordFontSize }}>
                <button
                  type="button"
                  className="mobile-practice-word-tap"
                  {...shortcut('R')}
                  onClick={playAgain}
                  disabled={paused}
                  aria-label={'点击单词重听发音：' + word.name}
                  title="点击单词重听发音"
                >
                  <span>{word.name}</span>
                  <Volume2 size={16} aria-hidden="true" />
                  {keyHint('R')}
                </button>
              </h2>
              {(audioState === 'tap' || audioState === 'error') && (
                <p className="mobile-audio-hint" role="status">
                  {audioState === 'tap' ? '点按单词播放发音' : '发音暂不可用，可点按单词重试或继续学习'}
                </p>
              )}
              {(word.ukphone || word.usphone) && (
                <p className="mobile-practice-phonetic">{word.ukphone ? '/' + word.ukphone + '/' : '/' + word.usphone + '/'}</p>
              )}
            </>
          ) : task === 'recall' ? (
            revealedAttempt ? (
              <div className="mobile-practice-revealed-word" data-mobile-answer-revealed>
                <h2 className="mobile-practice-word" style={{ fontSize: wordFontSize }}>
                  {word.name}
                </h2>
              </div>
            ) : (
              <p className="mobile-practice-cue">先在心中回忆，再判断是否记得</p>
            )
          ) : task === 'spelling' ? (
            <p className="mobile-practice-cue">根据词义，完整拼写英文单词</p>
          ) : task === 'audio' ? (
            <div className="mobile-practice-audio-hero" aria-hidden="true">
              <Headphones size={35} strokeWidth={1.6} />
            </div>
          ) : task === 'meaning-choice' ? (
            <h2 className="mobile-practice-word" style={{ fontSize: wordFontSize }}>
              {word.name}
            </h2>
          ) : (
            <p className="mobile-practice-cue">选出空缺的单词</p>
          )}
        </div>

        <div className="mobile-practice-example-slot" data-mobile-example-slot>
          {feedback || task === 'exposure' ? (
            renderExample(true)
          ) : task === 'spelling' ? (
            renderExample(false)
          ) : task === 'recall' ? (
            renderExample(Boolean(revealedAttempt))
          ) : task === 'context' ? (
            renderExample(false)
          ) : task === 'audio' ? (
            <>
              <p className="mobile-practice-cue">
                {audioState === 'playing' ? '正在发音…' : audioPlayed ? '选出刚才听到的单词' : '正在准备发音…'}
              </p>
              {audioPlayed && (
                <button
                  type="button"
                  className="mobile-practice-replay"
                  {...shortcut('R')}
                  onClick={playAgain}
                  disabled={paused || isSaving}
                >
                  <Volume2 size={17} aria-hidden="true" /> 再听一遍 {keyHint('R')}
                </button>
              )}
            </>
          ) : (
            <p className="mobile-practice-cue">哪个意思与这个词相符？</p>
          )}
          {task === 'recall' && revealedAttempt?.grade === 'good' && !feedback && !error && (
            <div className="mobile-practice-recall-check">
              <p className="mobile-practice-cue mobile-practice-recall-cue">
                {keyboardControls ? '核对答案 · 若记错，按 X 或点击纠正' : '核对答案 · 若记错，请点右侧圆点'}
              </p>
              <button
                type="button"
                className="mobile-practice-recall-correction-dot"
                data-mobile-recall-correct
                {...shortcut('X')}
                aria-label="我记错了，改为忘了"
                title="我记错了 · 改为忘了"
                onClick={correctRecall}
                disabled={paused || isSaving}
              >
                {keyboardControls ? (
                  <>我记错了 {keyHint('X')}</>
                ) : (
                  <span aria-hidden="true" className="mobile-practice-recall-correction-mark" />
                )}
              </button>
            </div>
          )}
        </div>

        <div className="mobile-practice-meaning-slot" data-mobile-meaning-slot>
          <div className="mobile-practice-definition-scroll" data-mobile-definition-scroll>
            {(feedback || task === 'exposure' || task === 'recall' || task === 'spelling') && (
              <p className="mobile-practice-meaning">{meanings}</p>
            )}
            {(feedback || task === 'exposure' || (task === 'recall' && Boolean(revealedAttempt))) && example?.cn && (
              <p className="mobile-practice-example-cn" data-mobile-example-cn>
                {example.cn}
              </p>
            )}
          </div>
        </div>
      </div>

      <footer className="mobile-practice-actions" data-mobile-action-zone>
        {!feedback && !revealedAttempt && !pendingSpelling && isCoreRecall && (task === 'recall' || task === 'spelling') && (
          <button
            type="button"
            className="mobile-practice-mode-toggle"
            data-mobile-interaction-toggle
            {...shortcut('W')}
            onClick={() => {
              const preference = task === 'recall' ? 'cold-spelling' : 'tap-recall'
              setManualExercise(preference)
              if (!desktop) setMobileInput((old) => ({ ...old, preference }))
              setSpellingInput('')
            }}
            disabled={paused || isSaving}
          >
            {task === 'recall' ? '改用独立拼写' : '改用轻触回忆'} {keyHint('W')}
          </button>
        )}
        {error && (
          <p className="mobile-practice-error" role="alert">
            {error}
          </p>
        )}
        {feedback ? (
          error ? (
            <button type="button" className="mobile-practice-primary" onClick={() => void advanceAfterFeedback(feedback)} disabled={paused}>
              重试继续学习
            </button>
          ) : feedback.autoAdvance ? (
            <p className="mobile-practice-next-hint" role="status">
              已保存 · 自动进入下一个
            </p>
          ) : (
            <button
              type="button"
              className="mobile-practice-primary"
              data-mobile-manual-next
              {...shortcut('Space')}
              onClick={() => void advanceAfterFeedback(feedback)}
              disabled={paused}
            >
              看清答案后 · 下一词 {keyHint('Space')}
            </button>
          )
        ) : task === 'exposure' ? (
          <button
            type="button"
            className="mobile-practice-primary"
            {...shortcut('Space')}
            onClick={() =>
              void saveAttempt({
                mode: 'exposure',
                grade: 'good',
                wrongCount: 0,
                title: '初次学习完成',
              })
            }
            disabled={paused || isSaving}
          >
            {isSaving ? '正在保存…' : '继续学习'} {keyHint('Space')}
          </button>
        ) : task === 'spelling' && pendingSpelling ? (
          <div className="mobile-practice-spelling-judgment" data-mobile-spelling-judgment>
            <p>刚才输入了「{pendingSpelling}」。在查看正确答案前，请判断：</p>
            <button
              type="button"
              className="mobile-practice-grade"
              data-mobile-spelling-cause="spelling"
              {...shortcut('A', '1')}
              disabled={paused || isSaving}
              onClick={() => resolveSpellingMismatch(true)}
            >
              想起来了，只是拼错 {keyHint('A')}
            </button>
            <button
              type="button"
              className="mobile-practice-grade"
              data-mobile-spelling-cause="recall"
              {...shortcut('S', '2')}
              disabled={paused || isSaving}
              onClick={() => resolveSpellingMismatch(false)}
            >
              没有想起来 {keyHint('S')}
            </button>
          </div>
        ) : task === 'spelling' ? (
          <form
            className="mobile-practice-spelling-form"
            data-mobile-spelling-form
            onSubmit={(event) => {
              event.preventDefault()
              if (!composingRef.current) submitSpelling()
            }}
          >
            <input
              ref={spellingInputRef}
              type="text"
              aria-label="独立拼写单词"
              placeholder="输入完整英文单词"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={spellingInput}
              onChange={(event) => setSpellingInput(event.target.value)}
              onCompositionStart={() => {
                composingRef.current = true
              }}
              onCompositionEnd={() => {
                composingRef.current = false
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229))
                  event.preventDefault()
              }}
              disabled={paused || isSaving || Boolean(pendingSpelling)}
            />
            <button
              type="submit"
              className="mobile-practice-primary"
              aria-keyshortcuts={keyboardControls ? 'Enter' : undefined}
              disabled={paused || isSaving || !spellingInput.trim()}
            >
              {isSaving ? '正在保存…' : '确认拼写'} {keyHint('Enter')}
            </button>
          </form>
        ) : task === 'recall' ? (
          revealedAttempt ? (
            error ? (
              <button
                type="button"
                className="mobile-practice-primary"
                {...shortcut('Space')}
                disabled={paused || isSaving}
                onClick={() =>
                  void saveAttempt({
                    mode: 'recall',
                    grade: revealedAttempt.grade,
                    wrongCount: revealedAttempt.grade === 'again' ? 1 : 0,
                    title:
                      revealedAttempt.grade === 'again'
                        ? '还需要巩固'
                        : revealedAttempt.grade === 'hard'
                        ? '已标记为模糊'
                        : '记住了（自评）',
                    frozen: revealedAttempt,
                  })
                }
              >
                {isSaving ? '正在保存…' : '保存失败 · 重试'} {keyHint('Space')}
              </button>
            ) : revealedAttempt.grade === 'good' ? (
              <p className="mobile-practice-next-hint" role="status">
                {isSaving ? '正在保存…' : '核对中 · 即将自动保存'}
              </p>
            ) : (
              <p className="mobile-practice-next-hint" role="status">
                正在保存回忆结果…
              </p>
            )
          ) : (
            <div className="mobile-practice-grade-grid" aria-label="回忆程度（回答前判断）">
              {RECALL_GRADES.map(({ rating, label }, index) => (
                <button
                  key={rating}
                  type="button"
                  className="mobile-practice-grade"
                  data-mobile-grade={rating}
                  {...shortcut(['A', 'S', 'D'][index], String(index + 1))}
                  onClick={() => rateRecall(rating)}
                  disabled={paused || isSaving}
                >
                  {label} {keyHint(['A', 'S', 'D'][index])}
                </button>
              ))}
            </div>
          )
        ) : audioFailed ? (
          <button
            type="button"
            className="mobile-practice-primary"
            {...shortcut('Space')}
            onClick={() => setAudioFallback(true)}
            disabled={paused}
          >
            无法播放 · 改练词义 {keyHint('Space')}
          </button>
        ) : audioRequiresTap ? (
          <button type="button" className="mobile-practice-primary" {...shortcut('R')} onClick={playAgain} disabled={paused}>
            <Headphones size={18} aria-hidden="true" /> {audioState === 'tap' ? '点按播放声音' : '正在加载发音…'} {keyHint('R')}
          </button>
        ) : (
          <div className="mobile-practice-choices" aria-label="答案选项">
            {choices.map((candidate, index) => (
              <button
                key={candidate.name}
                type="button"
                data-mobile-choice
                {...shortcut(['A', 'S', 'D', 'F'][index], String(index + 1))}
                className="mobile-practice-choice"
                onClick={() => choose(candidate.name)}
                disabled={paused || isSaving}
              >
                {task === 'meaning-choice' ? candidate.trans?.filter(Boolean).join('；') || '暂无释义' : candidate.name}
                {keyHint(['A', 'S', 'D', 'F'][index])}
              </button>
            ))}
          </div>
        )}
        {keyboardControls && (
          <div className="desktop-tap-shortcuts" aria-label="键盘操作提示" data-desktop-shortcuts>
            <span>
              {keyHint('Enter')}
              {!paused && task === 'spelling' && !pendingSpelling && !feedback ? '输入时确认拼写' : '暂停 / 继续'}
            </span>
            <span>{keyHint('Tab')}切换控件</span>
            <span>也可鼠标点击</span>
          </div>
        )}
      </footer>

      {paused && (
        <div className="mobile-practice-overlay" data-mobile-paused role="status">
          <p>学习已暂停</p>
          <button type="button" className="mobile-practice-primary" onClick={onResume}>
            继续学习 {keyHint('Enter')}
          </button>
        </div>
      )}
    </section>
  )
}
