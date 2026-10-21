import { Headphones, Volume2 } from 'lucide-react'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { generateWordSoundSrc } from '@/hooks/usePronunciation'
import type { LearnAcquisitionState } from '@/learn/acquisition'
import type { LearnItemKind } from '@/learn/session'
import type { TypingErrorClassification } from '@/review/classifier'
import type { ExerciseConditionV1 } from '@/review/condition'
import { createCanonicalReviewProbePlan, createReviewPolicyDecision } from '@/review/decision'
import type { ReviewExercisePlanV1, ReviewPolicyDecisionV1 } from '@/review/decision'
import type { ReviewEvidenceV1 } from '@/review/evidence'
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

type MobileTask = 'exposure' | 'context' | 'audio' | 'meaning-choice' | 'recall'
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
}

type SavedAttempt = {
  result: WordFinishResult
  title: string
  correct: boolean
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
  if (task === 'recall' && isCoreRecall && plan) return plan.condition
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
  const hidden = task === 'recall'
  return {
    version: 1,
    answerVisibilityAtStart: hidden ? 'hidden' : 'full',
    answerVisibleRatioAtStart: hidden ? 0 : 1,
    answerRevealed: false,
    revealedBeforeFirstKey: false,
    revealCount: 0,
    exampleVisibleAtStart: hasExample && (task === 'exposure' || task === 'context' || task === 'recall'),
    meaningVisibleAtStart: task === 'exposure' || task === 'recall' || task === 'meaning-choice',
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
  const exampleText = maskedExample
    ? maskedExample.before + maskedExample.masked + maskedExample.after
    : ''
  const meanings = word.trans?.filter(Boolean).join('；') || '暂无释义'
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
  const task: MobileTask = itemKind !== 'acquisition'
    ? 'recall'
    : phase === 'exposure' ? 'exposure'
      : phase === 'guided'
        ? maskedExample && choices.length > 1 ? 'context'
          : choices.length > 1 ? 'meaning-choice' : 'recall'
        : phase === 'supported'
          ? audioFallback ? 'meaning-choice' : choices.length > 1 ? 'audio' : 'recall'
          : 'recall'
  const isCoreRecall = itemKind === 'review' || (itemKind === 'acquisition' && phase === 'independent')
  const activePlan = exercisePlan ?? (isCoreRecall ? createCanonicalReviewProbePlan() : undefined)
  const wantsAutomaticSound = task === 'audio' || task === 'exposure'
  const source = pronunciation.type ? generateWordSoundSrc(word.name, pronunciation.type) : ''

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
      : grade === 'hard' && itemKind === 'review' ? 'uncertain' : 'clean'
    const classification = classificationFor(cause)
    const independent = mode === 'recall' && isCoreRecall
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
        ...(mode === 'recall' ? ['recall-committed-before-answer-reveal'] : []),
        ...(mode === 'audio' && !audioPlayed ? ['audio-cue-not-played'] : []),
        'self-rated-' + grade,
      ],
    }
    let reviewRatingDecision: RatingDecision | undefined
    if (itemKind === 'review' && reviewAttemptRole && mode === 'recall') {
      reviewRatingDecision = decideReviewRating({
        attemptRole: reviewAttemptRole, condition, classification, evidence,
      })
    }
    return { classification, evidence, reviewRatingDecision }
  }

  const saveAttempt = async (input: {
    mode: MobileTask; grade: ReviewOutcome; wrongCount: number
    title: string; correct: boolean
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
      setFeedback({
        result: { record, wrongCount: input.wrongCount, classification, reviewRatingDecision, reviewEvidence: evidence },
        correct: input.correct,
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

  const revealAnswer = () => {
    if (paused || feedback || revealedAttempt || isSaving) return
    const condition = getCondition('recall')
    setRevealedAttempt({
      condition,
      learningContext: learningContextForTask('recall', Boolean(maskedExample), false, false),
      policyDecision: getPolicy(condition, 'recall'),
    })
  }

  const rateRecall = (grade: ReviewOutcome) => {
    if (!revealedAttempt) return
    void saveAttempt({
      mode: 'recall', grade, wrongCount: grade === 'again' ? 1 : 0,
      title: grade === 'again' ? '还需要巩固' : grade === 'hard' ? '已标记为模糊' : '记住了',
      correct: grade !== 'again',
      frozen: revealedAttempt,
    })
  }

  const choose = (name: string) => {
    if (task === 'audio' && !audioPlayed) return
    const correct = name === word.name
    void saveAttempt({
      mode: task, grade: correct ? 'good' : 'again', wrongCount: correct ? 0 : 1,
      title: correct ? '答对了' : '再记一下这个词',
      correct,
    })
  }

  useEffect(() => {
    if (!feedback || paused) return
    // Retain the feedback briefly, then progress without another tap. Pausing
    // or leaving the screen cancels this timer; never advance in background.
    const timeout = window.setTimeout(() => {
      if (finishedRef.current) return
      finishedRef.current = true
      onFinish(feedback.result)
    }, feedback.correct ? 1000 : 1550)
    return () => window.clearTimeout(timeout)
  }, [feedback, onFinish, paused])

  const playAgain = () => playSound(true)
  const title = task === 'exposure' ? '认识新词'
    : task === 'context' ? '语境选择'
    : task === 'audio' ? '听音辨词'
    : task === 'meaning-choice' ? '词义识别' : '主动回忆'
  const audioRequiresTap = task === 'audio' && !audioPlayed && audioState !== 'error'
  const audioFailed = task === 'audio' && audioState === 'error'

  return (
    <section
      className="mobile-practice"
      data-mobile-word-practice
      data-mobile-task={task}
      data-mobile-word={word.name}
      aria-label="手机单词学习"
    >
      <header className="mobile-practice-head">
        <span className="mobile-eyebrow">LEARN</span>
        <div className="mobile-practice-title-row">
          <h1>{title}</h1>
          <span className="mobile-practice-step">{phase === 'independent' ? '独立回忆' : phase === 'supported' ? '巩固' : '学习中'}</span>
        </div>
      </header>

      <div className="mobile-practice-reading">
        {feedback ? (
          <div className="mobile-practice-feedback" data-mobile-feedback role="status">
            <p className="mobile-practice-feedback-status">{feedback.title}</p>
            <h2 className="mobile-practice-word">{word.name}</h2>
            <p className="mobile-practice-meaning">{meanings}</p>
            {example && <p className="mobile-practice-example">{example.en}</p>}
          </div>
        ) : task === 'exposure' ? (
          <div className="mobile-practice-lesson">
            <h2 className="mobile-practice-word">{word.name}</h2>
            {(word.ukphone || word.usphone) && (
              <p className="mobile-practice-phonetic">{word.ukphone ? '/' + word.ukphone + '/' : '/' + word.usphone + '/'}</p>
            )}
            <button type="button" className="mobile-practice-replay" onClick={playAgain} disabled={paused} aria-label="再听一遍">
              <Volume2 size={18} aria-hidden="true" /> {audioState === 'playing' ? '正在发音' : '再听一遍'}
            </button>
            <p className="mobile-practice-meaning">{meanings}</p>
            {example && <p className="mobile-practice-example">{example.en}</p>}
          </div>
        ) : task === 'recall' ? (
          <div className="mobile-practice-lesson">
            {revealedAttempt ? (
              <div data-mobile-answer-revealed>
                <h2 className="mobile-practice-word">{word.name}</h2>
                <p className="mobile-practice-meaning">{meanings}</p>
                {example && <p className="mobile-practice-example">{example.en}</p>}
                <p className="mobile-practice-cue">刚才想起来了吗？</p>
              </div>
            ) : (
              <>
                <p className="mobile-practice-cue">看意思，在心中想出英文</p>
                <p className="mobile-practice-meaning">{meanings}</p>
                {maskedExample && <p className="mobile-practice-example">{exampleText}</p>}
              </>
            )}
          </div>
        ) : task === 'audio' ? (
          <div className="mobile-practice-lesson">
            <div className="mobile-practice-audio-hero" aria-hidden="true"><Headphones size={35} strokeWidth={1.6}/></div>
            <p className="mobile-practice-cue">
              {audioState === 'playing' ? '正在发音…' : audioPlayed ? '选出刚才听到的单词' : '正在准备发音…'}
            </p>
            {audioPlayed && (
              <button type="button" className="mobile-practice-replay" onClick={playAgain} disabled={paused || isSaving}>
                <Volume2 size={17} aria-hidden="true"/> 再听一遍
              </button>
            )}
          </div>
        ) : task === 'context' ? (
          <div className="mobile-practice-lesson">
            <p className="mobile-practice-cue">选出句子中缺少的词</p>
            <p className="mobile-practice-example mobile-practice-context">{exampleText}</p>
          </div>
        ) : (
          <div className="mobile-practice-lesson">
            <p className="mobile-practice-cue">哪个意思与这个词相符？</p>
            <h2 className="mobile-practice-word">{word.name}</h2>
          </div>
        )}
      </div>

      <footer className="mobile-practice-actions" data-mobile-action-zone>
        {error && <p className="mobile-practice-error" role="alert">{error}</p>}
        {feedback ? (
          <p className="mobile-practice-next-hint" role="status">已保存 · 自动进入下一个</p>
        ) : task === 'exposure' ? (
          <button type="button" className="mobile-practice-primary" onClick={() => void saveAttempt({
            mode: 'exposure', grade: 'good', wrongCount: 0, title: '初次学习完成', correct: true,
          })} disabled={paused || isSaving}>
            {isSaving ? '正在保存…' : '继续学习'}
          </button>
        ) : task === 'recall' ? (
          !revealedAttempt ? (
            <button type="button" className="mobile-practice-primary" onClick={revealAnswer} disabled={paused || isSaving}>
              显示答案
            </button>
          ) : (
            <div className="mobile-practice-grade-grid" aria-label="回忆难度">
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
