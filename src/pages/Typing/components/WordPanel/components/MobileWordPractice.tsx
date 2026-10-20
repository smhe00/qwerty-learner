import { useMemo, useState } from 'react'
import { Headphones, Volume2 } from 'lucide-react'
import { useAtomValue } from 'jotai'
import usePronunciationSound from '@/hooks/usePronunciation'
import type { LearnAcquisitionState } from '@/learn/acquisition'
import type { LearnItemKind } from '@/learn/session'
import type { ExerciseConditionV1 } from '@/review/condition'
import { createCanonicalReviewProbePlan, createReviewPolicyDecision } from '@/review/decision'
import type { ReviewExercisePlanV1, ReviewPolicyDecisionV1 } from '@/review/decision'
import type { TypingErrorClassification } from '@/review/classifier'
import type { ReviewEvidenceV1 } from '@/review/evidence'
import { decideReviewRating } from '@/review/state-machine'
import type { RatingDecision, ReviewAttemptRole } from '@/review/state-machine'
import type { ReviewOutcome } from '@/review/types'
import { currentDictInfoAtom } from '@/store'
import type { Word } from '@/typings'
import { getUTCUnixTimestamp } from '@/utils/time'
import { getFirstValidDictionaryExample, maskDictionaryExample } from '@/utils/dictionaryExample'
import { db, useSaveWordRecord } from '@/utils/db'
import type { IWordRecord, LearningContextV1 } from '@/utils/db/record'
import type { WordFinishResult } from './Word'

type MobileTask = 'exposure' | 'context' | 'audio' | 'meaning-choice' | 'recall'

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
  id: number
  record: IWordRecord
  condition: ExerciseConditionV1
  learningContext: LearningContextV1
  policyDecision: ReviewPolicyDecisionV1
  mode: MobileTask
}

type SavedAttempt = {
  result: WordFinishResult
  correct: boolean
  title: string
  detail: string
}

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
  plan: ReviewExercisePlanV1 | undefined,
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
    letters: task === 'recall'
      ? { mode: 'all-hidden' }
      : { mode: 'all-visible' },
    probeDimension: task === 'audio' ? 'audio' : task === 'recall' ? 'none' : 'meaning',
  }
}

function learningContextForTask(
  task: MobileTask,
  hasExample: boolean,
  audioPlayed: boolean,
): LearningContextV1 {
  const hiddenAnswer = task === 'recall'
  return {
    version: 1,
    answerVisibilityAtStart: hiddenAnswer ? 'hidden' : 'full',
    answerVisibleRatioAtStart: hiddenAnswer ? 0 : 1,
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
    pronunciationAutomaticPlayCount: 0,
    pronunciationRequestedPlayCount: audioPlayed ? 1 : 0,
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
  paused,
  onResume,
}: MobileWordPracticeProps) {
  const currentDictInfo = useAtomValue(currentDictInfoAtom)
  const saveWordRecord = useSaveWordRecord()
  const { play, isPlaying, hasError } = usePronunciationSound(word.name)
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null)
  const [revealedAttempt, setRevealedAttempt] = useState<PendingRecallAttempt | null>(null)
  const [feedback, setFeedback] = useState<SavedAttempt | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [audioPlayed, setAudioPlayed] = useState(false)

  const example = useMemo(() => getFirstValidDictionaryExample(word), [word])
  const exampleParts = useMemo(
    () => example ? maskDictionaryExample(example) : null,
    [example],
  )
  const choices = useMemo(() => {
    const distractors = queue
      .filter((candidate) => candidate.name !== word.name && candidate.name.trim().length > 0)
      .filter((candidate, index, all) => all.findIndex((other) => other.name === candidate.name) === index)
      .sort((a, b) => stableKey(a.name) - stableKey(b.name))
      .slice(0, 3)
    return [...distractors, word].sort((a, b) => stableKey(a.name) - stableKey(b.name))
  }, [queue, word])

  const phase = itemKind === 'acquisition' ? acquisitionState?.phase : undefined
  const task: MobileTask = itemKind !== 'acquisition'
    ? 'recall'
    : phase === 'exposure'
      ? 'exposure'
      : phase === 'guided'
        ? (exampleParts && choices.length > 1 ? 'context' : choices.length > 1 ? 'meaning-choice' : 'recall')
        : phase === 'supported'
          ? (choices.length > 1 ? 'audio' : 'recall')
          : 'recall'

  const isIndependentAcquisition = itemKind === 'acquisition' && phase === 'independent'
  const isCoreRecall = itemKind === 'review' || isIndependentAcquisition
  const activePlan = exercisePlan ?? (isCoreRecall ? createCanonicalReviewProbePlan() : undefined)
  const exampleText = exampleParts
    ? exampleParts.before + exampleParts.masked + exampleParts.after
    : ''
  const meanings = word.trans?.filter(Boolean).join('；') || '暂无释义'
  const taskTitle = task === 'exposure'
    ? '认识新词'
    : task === 'context'
      ? '语境选择'
      : task === 'audio'
        ? '听音辨词'
        : task === 'meaning-choice'
          ? '词义识别'
          : '主动回忆'
  const phaseLabel = phase === 'exposure'
    ? '初次接触'
    : phase === 'guided'
      ? '语境练习'
      : phase === 'supported'
        ? '提示练习'
        : phase === 'independent'
          ? '独立回忆'
          : '复习'

  const playTargetAudio = () => {
    const accepted = play()
    if (accepted) setAudioPlayed(true)
  }

  const getCondition = (mode: MobileTask) =>
    conditionForTask(mode, isCoreRecall, activePlan)

  const getPolicyDecision = (
    condition: ExerciseConditionV1,
    mode: MobileTask,
  ): ReviewPolicyDecisionV1 => activePlan
    ? condition === activePlan.condition
      ? activePlan.decision
      : createReviewPolicyDecision(
          activePlan.decision.policyVersion,
          [...activePlan.decision.reasonCodes, 'mobile-task-' + mode],
          condition.version,
        )
    : createReviewPolicyDecision(
        'mobile-multidimensional-learning-v1',
        ['mobile-task-' + mode],
        condition.version,
      )

  const makeEvidence = (
    input: {
      mode: MobileTask
      grade: ReviewOutcome
      wrongCount: number
      condition: ExerciseConditionV1
    },
  ) => {
    const cause: TypingErrorClassification['cause'] =
      input.wrongCount > 0
        ? 'recall'
        : input.grade === 'hard' && itemKind === 'review'
          ? 'uncertain'
          : 'clean'
    const classification = classificationFor(cause)
    const independentEvidence = input.mode === 'recall' && isCoreRecall
    const evidence: ReviewEvidenceV1 = {
      version: 1,
      memoryGrade: input.grade,
      errorCause: cause,
      confidence: classification.confidence,
      evidenceStrength: input.grade === 'hard' ? 0.65 : 1,
      retrievalValidity: independentEvidence ? 'independent' : 'assisted',
      reasonCodes: [
        'mobile-multidimensional-learning',
        'mobile-task-' + input.mode,
        independentEvidence ? 'independent-retrieval' : 'assisted-practice',
        'self-rated-' + input.grade,
      ],
    }
    let reviewRatingDecision: RatingDecision | undefined
    if (itemKind === 'review' && reviewAttemptRole && input.mode === 'recall') {
      reviewRatingDecision = decideReviewRating({
        attemptRole: reviewAttemptRole,
        condition: input.condition,
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
    correct: boolean
    title: string
    detail: string
  }) => {
    if (paused || isSaving || feedback || revealedAttempt) return
    setIsSaving(true)
    setError('')
    const condition = getCondition(input.mode)
    const context = learningContextForTask(input.mode, Boolean(exampleParts), audioPlayed)
    const policyDecision = getPolicyDecision(condition, input.mode)
    const { classification, evidence, reviewRatingDecision } = makeEvidence({
      mode: input.mode,
      grade: input.grade,
      wrongCount: input.wrongCount,
      condition,
    })
    const record: IWordRecord = {
      word: word.name,
      timeStamp: getUTCUnixTimestamp(),
      dict: currentDictInfo.id,
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
      if (id <= 0) throw new Error('学习记录未能持久化，当前单词没有推进。')
      record.id = id
      const result: WordFinishResult = {
        record,
        wrongCount: input.wrongCount,
        classification,
        reviewRatingDecision,
        reviewEvidence: evidence,
      }
      setFeedback({
        result,
        correct: input.correct,
        title: input.title,
        detail: input.detail,
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  const startRecallAttempt = async () => {
    if (paused || isSaving || feedback || revealedAttempt) return
    setIsSaving(true)
    setError('')
    const mode: MobileTask = 'recall'
    const condition = getCondition(mode)
    const context = learningContextForTask(mode, Boolean(exampleParts), false)
    const policyDecision = getPolicyDecision(condition, mode)
    const record: IWordRecord = {
      word: word.name,
      timeStamp: getUTCUnixTimestamp(),
      dict: currentDictInfo.id,
      chapter: -1,
      timing: [],
      wrongCount: 0,
      mistakes: {},
      learningContext: context,
      exerciseCondition: condition,
      reviewPolicyDecision: policyDecision,
      sourceMode: 'learn',
      learnItemKind: recordKind,
    }

    try {
      const id = await saveWordRecord({
        word: word.name,
        wrongCount: 0,
        letterTimeArray: [],
        letterMistake: {},
        learningContext: context,
        exerciseCondition: condition,
        reviewPolicyDecision: policyDecision,
        sourceMode: 'learn',
        learnItemKind: recordKind,
      })
      if (id <= 0) throw new Error('学习记录未能持久化，当前单词没有推进。')
      record.id = id
      setRevealedAttempt({ id, record, condition, learningContext: context, policyDecision, mode })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  const submitGrade = async (grade: ReviewOutcome) => {
    const pending = revealedAttempt
    if (!pending || paused || isSaving || feedback) return
    setIsSaving(true)
    setError('')
    const wrongCount = grade === 'again' ? 1 : 0
    const { classification, evidence, reviewRatingDecision } = makeEvidence({
      mode: pending.mode,
      grade,
      wrongCount,
      condition: pending.condition,
    })
    const patch: Partial<IWordRecord> = { wrongCount, reviewEvidence: evidence }
    if (reviewRatingDecision !== undefined) patch.reviewRatingDecision = reviewRatingDecision
    try {
      const updated = await db.wordRecords.update(pending.id, patch)
      if (updated === 0) throw new Error('学习结果更新失败，请重试。')
      const record: IWordRecord = {
        ...pending.record,
        wrongCount,
        reviewEvidence: evidence,
        ...(reviewRatingDecision !== undefined ? { reviewRatingDecision } : {}),
      }
      const result: WordFinishResult = {
        record,
        wrongCount,
        classification,
        reviewRatingDecision,
        reviewEvidence: evidence,
      }
      setRevealedAttempt(null)
      setFeedback({
        result,
        correct: grade !== 'again',
        title: grade === 'again'
          ? '已标记为需要巩固'
          : grade === 'hard'
            ? '已记录：这次回忆比较费力'
            : grade === 'easy'
              ? '已记录：可以轻松回忆'
              : '已记录：能够回忆',
        detail: '记忆评价已保存，可继续下一项。',
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError))
    } finally {
      setIsSaving(false)
    }
  }

  const submitChoice = () => {
    if (!selectedChoice || paused || isSaving || feedback || revealedAttempt) return
    if (task === 'audio' && !audioPlayed && !hasError) {
      setError('请先播放发音，再确认答案。')
      return
    }
    const correct = selectedChoice === word.name
    void saveAttempt({
      mode: task,
      grade: correct ? 'good' : 'again',
      wrongCount: correct ? 0 : 1,
      correct,
      title: correct ? '选择正确' : '再留意这个词',
      detail: correct ? '这次识别正确。' : '正确答案已显示，下一次再尝试独立提取。',
    })
  }

  const submitExposure = () => {
    void saveAttempt({
      mode: 'exposure',
      grade: 'good',
      wrongCount: 0,
      correct: true,
      title: '已完成初次接触',
      detail: '已经记录初次学习，后续会逐步减少提示。',
    })
  }

  const continueAfterFeedback = () => {
    if (paused || isSaving || !feedback) return
    onFinish(feedback.result)
  }

  const prompt = task === 'context'
    ? '阅读句子，选择最适合填入空白的单词。'
    : task === 'audio'
      ? '先播放发音，再选择听到的单词。'
      : task === 'meaning-choice'
        ? '选择这个单词最符合的中文意思。'
        : '先在脑中回忆英文，再显示答案并评价回忆情况。'

  return (
    <section
      className="mobile-practice"
      data-mobile-word-practice
      data-mobile-task={task}
      data-mobile-word={word.name}
      aria-label="手机单词学习"
    >
      {!feedback ? (
        <>
          <header className="mobile-practice-head">
            <p className="mobile-eyebrow">TODAY · LEARN</p>
            <div className="mobile-practice-title-row">
              <h1>{taskTitle}</h1>
              <span className="mobile-practice-step">{phaseLabel}</span>
            </div>
            <p className="mobile-practice-prompt">{prompt}</p>
          </header>

          {task === 'exposure' ? (
            <div className="mobile-practice-content">
              <p className="mobile-practice-word">{word.name}</p>
              {(word.ukphone || word.usphone) && (
                <p className="mobile-practice-phonetic">
                  {word.ukphone ? '英 /' + word.ukphone + '/ ' : ''}
                  {word.usphone ? '美 /' + word.usphone + '/' : ''}
                </p>
              )}
              <button type="button" className="mobile-practice-audio" onClick={playTargetAudio} disabled={paused || isSaving}>
                <Volume2 size={18} aria-hidden="true" />
                {isPlaying ? '正在播放…' : hasError ? '重试发音' : '播放发音'}
              </button>
              <p className="mobile-practice-meaning">{meanings}</p>
              {exampleParts && (
                <div className="mobile-practice-example-block">
                  <p className="mobile-practice-example">{example?.en}</p>
                  <p className="mobile-practice-example-cn">{example?.cn}</p>
                </div>
              )}
              <button type="button" className="mobile-practice-primary" onClick={submitExposure} disabled={paused || isSaving}>
                {isSaving ? '正在保存…' : '我看好了，继续'}
              </button>
            </div>
          ) : task === 'recall' ? (
            <div className="mobile-practice-content">
              {!revealedAttempt ? (
                <>
                  <p className="mobile-practice-meaning">{meanings}</p>
                  {exampleParts && (
                    <div className="mobile-practice-example-block">
                      <p className="mobile-practice-example">{exampleText}</p>
                      <p className="mobile-practice-example-cn">{example?.cn}</p>
                    </div>
                  )}
                  <button type="button" className="mobile-practice-primary" onClick={() => void startRecallAttempt()} disabled={paused || isSaving}>
                    {isSaving ? '正在保存…' : '显示答案'}
                  </button>
                </>
              ) : (
                <div data-mobile-answer-revealed>
                  <p className="mobile-practice-word">{word.name}</p>
                  <button type="button" className="mobile-practice-audio" onClick={playTargetAudio} disabled={paused || isSaving}>
                    <Volume2 size={18} aria-hidden="true" />
                    {isPlaying ? '正在播放…' : '播放发音'}
                  </button>
                  <p className="mobile-practice-meaning">{meanings}</p>
                  {exampleParts && (
                    <div className="mobile-practice-example-block">
                      <p className="mobile-practice-example">{example?.en}</p>
                      <p className="mobile-practice-example-cn">{example?.cn}</p>
                    </div>
                  )}
                  <p className="mobile-practice-prompt">根据刚才的回忆情况，选择最符合的一项。</p>
                  <div className="mobile-practice-grade-grid" aria-label="回忆难度">
                    {([
                      ['again', '忘了', '没能想起来'],
                      ['hard', '困难', '费力想起'],
                      ['good', '记得', '基本顺利'],
                      ['easy', '很熟悉', '轻松回忆'],
                    ] as Array<[ReviewOutcome, string, string]>).map(([grade, label, description]) => (
                      <button
                        key={grade}
                        type="button"
                        className="mobile-practice-grade"
                        onClick={() => void submitGrade(grade)}
                        disabled={paused || isSaving}
                      >
                        <strong>{label}</strong>
                        <small>{description}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mobile-practice-content">
              {task === 'context' && exampleParts ? (
                <div className="mobile-practice-example-block">
                  <p className="mobile-practice-example">{exampleText}</p>
                </div>
              ) : task === 'audio' ? (
                <button type="button" className="mobile-practice-audio" onClick={playTargetAudio} disabled={paused || isSaving}>
                  <Headphones size={18} aria-hidden="true" />
                  {isPlaying ? '正在播放…' : hasError ? '重试发音' : '播放目标单词发音'}
                </button>
              ) : (
                <p className="mobile-practice-word">{word.name}</p>
              )}
              <div className="mobile-practice-choices" aria-label="答案选项">
                {choices.map((candidate) => (
                  <button
                    key={candidate.name}
                    type="button"
                    data-mobile-choice
                    aria-pressed={selectedChoice === candidate.name}
                    className="mobile-practice-choice"
                    onClick={() => setSelectedChoice(candidate.name)}
                    disabled={paused || isSaving}
                  >
                    {task === 'meaning-choice'
                      ? candidate.trans?.filter(Boolean).join('；') || '暂无释义'
                      : candidate.name}
                  </button>
                ))}
              </div>
              <button type="button" className="mobile-practice-primary" onClick={submitChoice}
                disabled={paused || isSaving || !selectedChoice}>
                {isSaving ? '正在保存…' : '确认选择'}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="mobile-practice-feedback" data-mobile-feedback>
          <p className="mobile-eyebrow">ANSWER</p>
          <h1>{feedback.title}</h1>
          <p className="mobile-practice-word">{word.name}</p>
          <button type="button" className="mobile-practice-audio" onClick={playTargetAudio} disabled={paused || isSaving}>
            <Volume2 size={18} aria-hidden="true" />
            {isPlaying ? '正在播放…' : '播放发音'}
          </button>
          <p className="mobile-practice-meaning">{meanings}</p>
          {exampleParts && (
            <div className="mobile-practice-example-block">
              <p className="mobile-practice-example">{example?.en}</p>
              <p className="mobile-practice-example-cn">{example?.cn}</p>
            </div>
          )}
          <p className="mobile-practice-feedback-detail">{feedback.detail}</p>
          <button type="button" className="mobile-practice-primary" onClick={continueAfterFeedback} disabled={paused || isSaving}>
            继续
          </button>
        </div>
      )}

      {error && <p className="mobile-practice-error" role="alert">{error}</p>}

      {paused && (
        <div className="mobile-practice-overlay" data-mobile-paused role="status">
          <p>学习已暂停</p>
          <button type="button" className="mobile-practice-primary" onClick={onResume}>继续学习</button>
        </div>
      )}
    </section>
  )
}
