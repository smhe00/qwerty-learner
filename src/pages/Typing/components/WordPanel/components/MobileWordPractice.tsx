import { Headphones, Volume2 } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { generateWordSoundSrc } from '@/hooks/usePronunciation'
import { createLearnAcquisitionExercisePlanForState } from '@/learn/acquisition'
import type { LearnAcquisitionState } from '@/learn/acquisition'
import type { LearnItemKind } from '@/learn/session'
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
import { getFirstValidDictionaryExample, maskDictionaryExample } from '@/utils/dictionaryExample'
import { useSaveWordRecord } from '@/utils/db'
import type { IWordRecord, LearningContextV1 } from '@/utils/db/record'
import { getUTCUnixTimestamp } from '@/utils/time'
import type { WordFinishResult } from './Word'

type MobileTask = 'exposure' | 'context' | 'audio' | 'meaning-choice' | 'recall' | 'spelling'
type AudioState = 'idle' | 'playing' | 'played' | 'tap' | 'error'

type MobileWordPracticeProps = {
  word: Word
  queue: Word[]
  onFinish: (result: WordFinishResult) => void
  exercisePlan?: ReviewExercisePlanV1
  itemKind: LearnItemKind
  recordKind: LearnItemKind
  acquisitionState?: LearnAcquisitionState
  reviewAttemptRole?: ReviewAttemptRole
  paused: boolean
  onResume: () => void
}

type PendingRecallAttempt = {
  condition: ExerciseConditionV1
  learningContext: LearningContextV1
  policyDecision: ReviewPolicyDecisionV1
  // Captured while the answer and its spelling are still hidden.
  grade: ReviewOutcome
}

type SavedAttempt = {
  result: WordFinishResult
  title: string
  // Only an unassisted full-success response advances without another tap.
  // A Hard self-rating or a wrong choice needs time for reviewing feedback.
  autoAdvance: boolean
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
    scores: cause === 'recall'
      ? { recall: 1, spelling: 0, motor: 0 }
      : cause === 'uncertain'
        ? { recall: 1 / 3, spelling: 1 / 3, motor: 1 / 3 }
        : { recall: 0, spelling: 0, motor: 0 },
  }
}

function conditionForTask(
  task: MobileTask,
  isCoreRecall: boolean,
  plan?: ReviewExercisePlanV1,
): ExerciseConditionV1 {
  if (task === 'exposure' && plan) return plan.condition
  if ((task === 'recall' || task === 'spelling') && isCoreRecall && plan) return plan.condition
  return {
    version: 1,
    purpose: 'training',
    source: 'adaptive-policy',
    audio: task === 'audio' ? 'automatic' : 'none',
    meaning: task === 'meaning-choice' || task === 'recall' ? 'visible' : 'hidden',
    phonetic: task === 'exposure' ? 'visible' : 'hidden',
    letters: { mode: task === 'recall' ? 'all-hidden' : 'all-visible' },
    probeDimension: task === 'audio' ? 'audio' : task === 'recall' ? 'none' : 'meaning',
  }
}

function learningContextForTask(
  task: MobileTask,
  hasExample: boolean,
  audioPlayed: boolean,
  manuallyPlayed: boolean,
): LearningContextV1 {
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
  word, queue, onFinish, exercisePlan, itemKind, recordKind,
  acquisitionState, reviewAttemptRole, paused, onResume,
}: MobileWordPracticeProps) {
  const dict = useAtomValue(currentDictInfoAtom)
  const pronunciation = useAtomValue(pronunciationConfigAtom)
  const saveWordRecord = useSaveWordRecord()
  const [revealedAttempt, setRevealedAttempt] = useState<PendingRecallAttempt | null>(null)
  const [feedback, setFeedback] = useState<SavedAttempt | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [preferSpelling, setPreferSpelling] = useState(false)
  const [spellingInput, setSpellingInput] = useState('')
  const [error, setError] = useState('')
  const [audioState, setAudioState] = useState<AudioState>('idle')
  const [audioPlayed, setAudioPlayed] = useState(false)
  const [manualAudioPlayed, setManualAudioPlayed] = useState(false)
  const [audioFallback, setAudioFallback] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const autoAudioAttempted = useRef(false)
  const playbackWasRequestedRef = useRef(false)
  const submittingRef = useRef(false)
  const finishedRef = useRef(false)

  const example = useMemo(() => getFirstValidDictionaryExample(word), [word])
  const maskedExample = example ? maskDictionaryExample(example) : null
  const meanings = word.trans?.filter(Boolean).join('；') || '暂无释义'
  const exampleFontSize = example && example.en.length > 205
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
    const differentMeanings = candidates.filter(
      (candidate) => candidate.trans?.filter(Boolean).join('；') !== targetMeaning,
    )
    const distractors = (differentMeanings.length >= 3 ? differentMeanings : candidates)
      .sort((a, b) => stableKey(a.name) - stableKey(b.name))
      .slice(0, 3)
    return [...distractors, word].sort((a, b) => stableKey(a.name) - stableKey(b.name))
  }, [queue, word])

  const phase = itemKind === 'acquisition' ? acquisitionState?.phase : undefined
  const baseTask: MobileTask = itemKind !== 'acquisition'
    ? 'recall'
    : phase === 'exposure' ? 'exposure'
      : phase === 'guided'
        ? maskedExample && choices.length > 1 ? 'context'
          : choices.length > 1 ? 'meaning-choice' : 'recall'
        : phase === 'supported'
          ? audioFallback ? 'meaning-choice' : choices.length > 1 ? 'audio' : 'recall'
          : 'recall'
  const task: MobileTask = baseTask === 'recall' && preferSpelling ? 'spelling' : baseTask
  const isCoreRecall = itemKind === 'review' || (itemKind === 'acquisition' && phase === 'independent')
  // Phone-only Acquisition must obey the SAME Independent admission plan as
  // desktop spelling. Never silently substitute the Review canonical policy:
  // that would save a Good self-report but prevent this new word's admission.
  const activePlan = exercisePlan ??
    (itemKind === 'acquisition' && acquisitionState &&
      acquisitionState.phase !== 'complete' && acquisitionState.phase !== 'deferred'
      ? createLearnAcquisitionExercisePlanForState(acquisitionState)
      : isCoreRecall ? createCanonicalReviewProbePlan() : undefined)
  const wantsAutomaticSound = task === 'audio' || task === 'exposure'
  const source = generateWordSoundSrc(word.name, pronunciation.type || 'uk')

  const playSound = useCallback((requested = false) => {
    playbackWasRequestedRef.current = requested
    if (!source) {
      setAudioState('error')
      return
    }
    let audio = audioRef.current
    if (!audio) {
      audio = new Audio(source)
      audio.preload = 'auto'
      audio.volume = pronunciation.volume
      audio.playbackRate = pronunciation.rate
      audioRef.current = audio
      const owned = audio
      owned.addEventListener('playing', () => {
        if (audioRef.current !== owned) return
        setAudioPlayed(true)
        if (playbackWasRequestedRef.current) setManualAudioPlayed(true)
        setAudioState('playing')
      })
      owned.addEventListener('ended', () => {
        if (audioRef.current === owned) setAudioState('played')
      })
      owned.addEventListener('error', () => {
        if (audioRef.current === owned) setAudioState('error')
      })
    }
    audio.volume = pronunciation.volume
    audio.playbackRate = pronunciation.rate
    const owned = audio
    try {
      const result = owned.play()
      void result?.catch((reason: unknown) => {
        if (audioRef.current !== owned) return
        const blocked = reason instanceof DOMException && reason.name === 'NotAllowedError'
        setAudioState(blocked ? 'tap' : 'error')
      })
    } catch (reason) {
      const blocked = reason instanceof DOMException && reason.name === 'NotAllowedError'
      setAudioState(blocked ? 'tap' : 'error')
    }
  }, [source, pronunciation.rate, pronunciation.volume])

  useEffect(() => {
    return () => {
      // React StrictMode replays mount effects in development. Re-arm the
      // initial sound so replayed setup still gets its own live audio owner.
      autoAudioAttempted.current = false
      const audio = audioRef.current
      audioRef.current = null
      if (audio) {
        audio.pause()
        audio.removeAttribute('src')
      }
    }
  }, [])

  useEffect(() => {
    if (paused) {
      audioRef.current?.pause()
      return
    }
    if (wantsAutomaticSound && !autoAudioAttempted.current) {
      autoAudioAttempted.current = true
      playSound(false)
    }
  }, [paused, wantsAutomaticSound, playSound])

  const getCondition = (mode: MobileTask) => conditionForTask(mode, isCoreRecall, activePlan)
  const getPolicy = (condition: ExerciseConditionV1, mode: MobileTask): ReviewPolicyDecisionV1 =>
    activePlan
      ? condition === activePlan.condition ? activePlan.decision
        : createReviewPolicyDecision(
            activePlan.decision.policyVersion,
            [...activePlan.decision.reasonCodes, 'mobile-task-' + mode],
            condition.version,
          )
      : createReviewPolicyDecision('mobile-multidimensional-learning-v1', ['mobile-task-' + mode], condition.version)

  const makeEvidence = (mode: MobileTask, grade: ReviewOutcome, wrongCount: number, condition: ExerciseConditionV1) => {
    const cause: TypingErrorClassification['cause'] = wrongCount > 0
      ? 'recall'
      : grade === 'hard' ? 'uncertain' : 'clean'
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
        'mobile-multidimensional-learning', 'mobile-task-' + mode,
        independent ? 'independent-retrieval' : 'assisted-practice',
        ...(mode === 'recall'
          ? ['self-report-not-spelling', 'self-rated-before-answer-reveal']
          : mode === 'spelling'
            ? [wrongCount === 0 ? 'objective-spelling-clean' : 'objective-spelling-mismatch', 'typed-with-answer-hidden']
            : ['recognition-or-training-evidence']),
        ...(mode === 'audio' && !audioPlayed ? ['audio-cue-not-played'] : []),
        mode === 'recall'
          ? 'self-rated-' + grade
          : mode === 'spelling' ? 'objectively-checked-' + grade : 'choice-graded-' + grade,
      ],
    }
    let reviewRatingDecision: RatingDecision | undefined
    if (itemKind === 'review' && reviewAttemptRole && (mode === 'recall' || mode === 'spelling')) {
      reviewRatingDecision = decideReviewRating({
        attemptRole: reviewAttemptRole, condition, classification, evidence,
      })
    }
    return { classification, evidence, reviewRatingDecision }
  }

  const saveAttempt = async (input: {
    mode: MobileTask; grade: ReviewOutcome; wrongCount: number
    title: string
    frozen?: PendingRecallAttempt
  }) => {
    if (paused || submittingRef.current || feedback) return
    submittingRef.current = true
    setIsSaving(true)
    setError('')
    const condition = input.frozen?.condition ?? getCondition(input.mode)
    const context = input.frozen?.learningContext ??
      learningContextForTask(input.mode, Boolean(maskedExample), audioPlayed, manualAudioPlayed)
    const policyDecision = input.frozen?.policyDecision ?? getPolicy(condition, input.mode)
    const { classification, evidence, reviewRatingDecision } = makeEvidence(
      input.mode, input.grade, input.wrongCount, condition,
    )
    const record: IWordRecord = {
      word: word.name,
      timeStamp: getUTCUnixTimestamp(),
      dict: dict.id,
      chapter: -1,
      timing: [],
      wrongCount: input.wrongCount,
      mistakes: {},
      learningContext: context,
      exerciseCondition: condition,
      reviewPolicyDecision: policyDecision,
      reviewEvidence: evidence,
      reviewRatingDecision,
      sourceMode: 'learn',
      learnItemKind: recordKind,
    }
    try {
      const id = await saveWordRecord({
        word: word.name,
        wrongCount: input.wrongCount,
        letterTimeArray: [],
        letterMistake: {},
        learningContext: context,
        exerciseCondition: condition,
        reviewPolicyDecision: policyDecision,
        reviewEvidence: evidence,
        reviewRatingDecision,
        sourceMode: 'learn',
        learnItemKind: recordKind,
      })
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
    setRevealedAttempt(frozen)
    if (grade !== 'good') {
      void saveAttempt({
        mode: 'recall', grade, wrongCount: grade === 'again' ? 1 : 0,
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
      mode: 'recall', grade: 'again', wrongCount: 1,
      title: '已纠正为忘了', frozen: revealedAttempt,
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
        mode: 'recall', grade: 'good', wrongCount: 0,
        title: '记住了（自评）', frozen: revealedAttempt,
      })
    }, 2600)
    return () => window.clearTimeout(timeout)
  }, [revealedAttempt, paused, feedback, error])

  const submitSpelling = () => {
    if (task !== 'spelling' || isSaving || paused || feedback) return
    const attempted = spellingInput.trim().normalize('NFKC')
    if (!attempted) return
    const expected = word.name.trim().normalize('NFKC')
    const correct = attempted.toLocaleLowerCase() === expected.toLocaleLowerCase()
    // Raw attempt evidence intentionally distinguishes typed cold spelling
    // from self-rated recall; a failed spelling is an Again, not a Good.
    void saveAttempt({
      mode: 'spelling',
      grade: correct ? 'good' : 'again',
      wrongCount: correct ? 0 : 1,
      title: correct ? '独立拼写正确' : '拼写未通过 · 请核对',
    })
  }

  const choose = (name: string) => {
    if (task === 'audio' && !audioPlayed) return
    const correct = name === word.name
    void saveAttempt({
      mode: task, grade: correct ? 'good' : 'again', wrongCount: correct ? 0 : 1,
      title: correct ? '答对了' : '再记一下这个词',
    })
  }

  const advanceAfterFeedback = useCallback((saved: SavedAttempt) => {
    if (paused || finishedRef.current) return
    finishedRef.current = true
    onFinish(saved.result)
  }, [onFinish, paused])

  useEffect(() => {
    if (!feedback?.autoAdvance || paused) return
    // Full success: briefly acknowledge the saved answer, then proceed.
    // Wrong and uncertain answers remain visible until an explicit next tap.
    const timeout = window.setTimeout(() => advanceAfterFeedback(feedback), 1000)
    return () => window.clearTimeout(timeout)
  }, [feedback, paused, advanceAfterFeedback])

  const playAgain = () => playSound(true)
  const title = task === 'spelling' ? '独立拼写' : task === 'exposure' ? '认识新词'
    : task === 'context' ? '语境选择'
    : task === 'audio' ? '听音辨词'
    : task === 'meaning-choice' ? '词义识别' : '主动回忆'
  const audioRequiresTap = task === 'audio' && !audioPlayed && audioState !== 'error'
  const audioFailed = task === 'audio' && audioState === 'error'

  // Reserve the top line for the complete orthographic answer. Long words
  // shrink before wrapping; neither examples nor definitions may push it away.
  const wordFontSize = word.name.length > 26
    ? 'clamp(17px, 4.7vw, 24px)'
    : word.name.length > 18
      ? 'clamp(19px, 6vw, 29px)'
      : word.name.length > 12
        ? 'clamp(23px, 7vw, 35px)'
        : 'clamp(29px, 8.4vw, 40px)'

  return (
    <section
      className="mobile-practice"
      data-mobile-word-practice
      data-mobile-task={task}
      data-mobile-policy={activePlan?.decision.policyVersion ?? 'training'}
      data-mobile-word={word.name}
      data-mobile-next-mode={feedback ? feedback.autoAdvance ? 'auto' : 'manual' : 'pending'}
      data-mobile-recall-stage={task === 'recall' ? feedback ? 'saved' : revealedAttempt ? 'verification' : 'unrevealed' : undefined}
      aria-label="手机单词学习"
    >
      <header className="mobile-practice-head">
        <span className="mobile-eyebrow">LEARN</span>
        <div className="mobile-practice-title-row">
          <h1>{title}</h1>
          <span className="mobile-practice-step">{phase === 'independent' ? '独立回忆' : phase === 'supported' ? '巩固' : '学习中'}</span>
        </div>
      </header>

      <div className="mobile-practice-reading" data-mobile-reading>
        <div className="mobile-practice-word-slot" data-mobile-word-slot>
          {feedback ? (
            <>
              <p className="mobile-practice-feedback-status" data-mobile-feedback role="status">{feedback.title}</p>
              <h2 className="mobile-practice-word" style={{ fontSize: wordFontSize }}>{word.name}</h2>
            </>
          ) : task === 'exposure' ? (
            <>
              <h2 className="mobile-practice-word" style={{ fontSize: wordFontSize }}>
                <button
                  type="button"
                  className="mobile-practice-word-tap"
                  onClick={playAgain}
                  disabled={paused}
                  aria-label={'点击单词重听发音：' + word.name}
                  title="点击单词重听发音"
                >
                  <span>{word.name}</span>
                  <Volume2 size={16} aria-hidden="true" />
                </button>
              </h2>
              {(word.ukphone || word.usphone) && (
                <p className="mobile-practice-phonetic">{word.ukphone ? '/' + word.ukphone + '/' : '/' + word.usphone + '/'}</p>
              )}
            </>
          ) : task === 'recall' ? (
            revealedAttempt ? (
              <div className="mobile-practice-revealed-word" data-mobile-answer-revealed>
                <h2 className="mobile-practice-word" style={{ fontSize: wordFontSize }}>{word.name}</h2>
              </div>
            ) : (
              <p className="mobile-practice-cue">先在心中回忆，再判断是否记得</p>
            )
          ) : task === 'spelling' ? (
            <p className="mobile-practice-cue">根据词义，完整拼写英文单词</p>
          ) : task === 'audio' ? (
            <div className="mobile-practice-audio-hero" aria-hidden="true"><Headphones size={35} strokeWidth={1.6} /></div>
          ) : task === 'meaning-choice' ? (
            <h2 className="mobile-practice-word" style={{ fontSize: wordFontSize }}>{word.name}</h2>
          ) : (
            <p className="mobile-practice-cue">选出空缺的单词</p>
          )}
        </div>

        <div className="mobile-practice-example-slot" data-mobile-example-slot>
          {feedback || task === 'exposure'
            ? renderExample(true)
            : task === 'spelling'
              ? renderExample(false)
              : task === 'recall'
              ? renderExample(Boolean(revealedAttempt))
              : task === 'context'
                ? renderExample(false)
                : task === 'audio'
                  ? (
                    <>
                      <p className="mobile-practice-cue">
                        {audioState === 'playing' ? '正在发音…' : audioPlayed ? '选出刚才听到的单词' : '正在准备发音…'}
                      </p>
                      {audioPlayed && (
                        <button type="button" className="mobile-practice-replay" onClick={playAgain} disabled={paused || isSaving}>
                          <Volume2 size={17} aria-hidden="true" /> 再听一遍
                        </button>
                      )}
                    </>
                  )
                  : <p className="mobile-practice-cue">哪个意思与这个词相符？</p>}
          {task === 'recall' && revealedAttempt?.grade === 'good' && !feedback && (
            <p className="mobile-practice-cue mobile-practice-recall-cue">核对你刚才的回忆 · 不一致请点「记错了」</p>
          )}
        </div>

        <div className="mobile-practice-meaning-slot" data-mobile-meaning-slot>
          <div className="mobile-practice-definition-scroll" data-mobile-definition-scroll>
            {(feedback || task === 'exposure' || task === 'recall' || task === 'spelling') && (
              <p className="mobile-practice-meaning">{meanings}</p>
            )}
            {(feedback || task === 'exposure' || (task === 'recall' && Boolean(revealedAttempt))) && example?.cn && (
              <p className="mobile-practice-example-cn" data-mobile-example-cn>{example.cn}</p>
            )}
          </div>
        </div>
      </div>

      <footer className="mobile-practice-actions" data-mobile-action-zone>
        {!feedback && !revealedAttempt && (task === 'recall' || task === 'spelling') && (
          <button
            type="button"
            className="mobile-practice-mode-toggle"
            data-mobile-interaction-toggle
            onClick={() => { setPreferSpelling((previous) => !previous); setSpellingInput('') }}
            disabled={paused || isSaving}
          >
            {task === 'recall' ? '改用独立拼写' : '改用轻触回忆'}
          </button>
        )}
        {error && <p className="mobile-practice-error" role="alert">{error}</p>}
        {feedback ? (
          feedback.autoAdvance ? (
            <p className="mobile-practice-next-hint" role="status">已保存 · 自动进入下一个</p>
          ) : (
            <button
              type="button"
              className="mobile-practice-primary"
              data-mobile-manual-next
              onClick={() => advanceAfterFeedback(feedback)}
              disabled={paused}
            >
              看清答案后 · 下一词
            </button>
          )
        ) : task === 'exposure' ? (
          <button type="button" className="mobile-practice-primary" onClick={() => void saveAttempt({
            mode: 'exposure', grade: 'good', wrongCount: 0, title: '初次学习完成',
          })} disabled={paused || isSaving}>
            {isSaving ? '正在保存…' : '继续学习'}
          </button>
        ) : task === 'spelling' ? (
          <form
            className="mobile-practice-spelling-form"
            data-mobile-spelling-form
            onSubmit={(event) => { event.preventDefault(); submitSpelling() }}
          >
            <input
              type="text"
              aria-label="独立拼写单词"
              placeholder="输入完整英文单词"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={spellingInput}
              onChange={(event) => setSpellingInput(event.target.value)}
              disabled={paused || isSaving}
            />
            <button type="submit" className="mobile-practice-primary" disabled={paused || isSaving || !spellingInput.trim()}>
              {isSaving ? '正在保存…' : '确认拼写'}
            </button>
          </form>
        ) : task === 'recall' ? (
          revealedAttempt ? (
            revealedAttempt.grade === 'good' ? (
              <button
                type="button"
                className="mobile-practice-primary mobile-practice-correction"
                data-mobile-recall-correct
                onClick={error
                  ? () => void saveAttempt({
                      mode: 'recall', grade: 'good', wrongCount: 0,
                      title: '记住了（自评）', frozen: revealedAttempt,
                    })
                  : correctRecall}
                disabled={paused || isSaving}
              >
                {isSaving ? '正在保存…' : error ? '保存失败 · 重试' : '记错了 · 改为忘了'}
              </button>
            ) : (
              <p className="mobile-practice-next-hint" role="status">正在保存回忆结果…</p>
            )
          ) : (
            <div className="mobile-practice-grade-grid" aria-label="回忆程度（回答前判断）">
              {RECALL_GRADES.map(({ rating, label }) => (
                <button
                  key={rating}
                  type="button"
                  className="mobile-practice-grade"
                  data-mobile-grade={rating}
                  onClick={() => rateRecall(rating)}
                  disabled={paused || isSaving}
                >
                  {label}
                </button>
              ))}
            </div>
          )
        ) : audioFailed ? (
          <button type="button" className="mobile-practice-primary" onClick={() => setAudioFallback(true)} disabled={paused}>
            无法播放 · 改练词义
          </button>
        ) : audioRequiresTap ? (
          <button type="button" className="mobile-practice-primary" onClick={playAgain} disabled={paused}>
            <Headphones size={18} aria-hidden="true"/> {audioState === 'tap' ? '点按播放声音' : '正在加载发音…'}
          </button>
        ) : (
          <div className="mobile-practice-choices" aria-label="答案选项">
            {choices.map((candidate) => (
              <button
                key={candidate.name}
                type="button"
                data-mobile-choice
                className="mobile-practice-choice"
                onClick={() => choose(candidate.name)}
                disabled={paused || isSaving}
              >
                {task === 'meaning-choice'
                  ? candidate.trans?.filter(Boolean).join('；') || '暂无释义'
                  : candidate.name}
              </button>
            ))}
          </div>
        )}
      </footer>

      {paused && (
        <div className="mobile-practice-overlay" data-mobile-paused role="status">
          <p>学习已暂停</p>
          <button type="button" className="mobile-practice-primary" onClick={onResume}>继续学习</button>
        </div>
      )}
    </section>
  )
}
