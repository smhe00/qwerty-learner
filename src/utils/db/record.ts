import { getUTCUnixTimestamp } from '../index'
import type { LearnSessionKind } from '@/learn/session'
import type { ExerciseConditionV1 } from '@/review/condition'
import type {
  ReviewExercisePlanV1,
  ReviewPolicyDecisionV1,
  ReviewPolicyShadowV1,
} from '@/review/decision'
import type { ReviewEvidenceV1 } from '@/review/evidence'
import type { Word } from '@/typings'

export type WordAttemptResult = 'clean' | 'wrong'

export interface WordAttemptRecord {
  // Time from the attempt becoming ready to the first input key.
  startLatencyMs: number
  // Time from the first input key until this attempt succeeds or fails.
  durationMs: number
  // Number of correct prefix characters before the attempt ended.
  correctPrefixLength: number
  result: WordAttemptResult
  wrongIndex?: number
  wrongKey?: string
  interKeyIntervalsMs?: number[]
}

export interface WordRecordTelemetry {
  telemetryVersion: 2
  // Active foreground time only; background/blur pauses are excluded.
  firstKeyLatencyMs: number
  attempts: WordAttemptRecord[]
  backgroundPauseMs?: number
  backgroundPauseCount?: number
  backgroundPauseBeforeFirstKeyMs?: number
  backgroundPauseBeforeFirstKeyCount?: number
}

export type AnswerVisibility = 'full' | 'partial' | 'hidden'
export type PronunciationCue = 'automatic' | 'requested'

export interface ReviewHintContextV1 {
  version: 1
  maxLevel: 0 | 1 | 2 | 3
  coldProbeSurrendered: boolean
  advanceCount: 1 | 2 | 3 | 4
}

export interface LearningContextV1 {
  version: 1

  // Orthographic cue strength.
  answerVisibilityAtStart?: AnswerVisibility
  answerVisibleRatioAtStart?: number
  answerRevealed?: boolean
  revealedBeforeFirstKey?: boolean
  revealCount?: number
  lastAnswerRevealToFirstKeyMs?: number

  // Semantic cue strength.
  meaningVisibleAtStart?: boolean
  meaningRevealed?: boolean
  meaningRevealedBeforeFirstKey?: boolean
  meaningRevealCount?: number

  // Phonological cue strength.
  phoneticVisibleAtStart?: boolean
  pronunciationEnabledAtStart?: boolean
  pronunciationPlayed?: boolean
  pronunciationPlayedBeforeFirstKey?: boolean
  pronunciationPlayCount?: number
  pronunciationAutomaticPlayCount?: number
  pronunciationRequestedPlayCount?: number

  // Review-only cue escalation trace. Absence means no hint ladder was used.
  reviewHint?: ReviewHintContextV1
}

export interface IWordRecord {
  id?: number
  word: string
  timeStamp: number
  // 正常章节为 dictKey, 其他功能则为对应的类型
  dict: string
  // 用户可能是在 错题/其他类似组件中 进行的练习则为 null, start from 0
  chapter: number | null
  // 正确次数中输入每个字母的时间差，可以据此计算出总时间
  timing: number[]
  // 出错的次数
  wrongCount: number
  // 每个字母被错误输入成什么, index 为字母的索引, 数组内为错误的 e.key
  mistakes: LetterMistakes

  // Optional additive typing evidence. Absence means this record predates telemetry.
  typingTelemetry?: WordRecordTelemetry

  // Optional semantic learning conditions. Absence means "unknown", never false.
  learningContext?: LearningContextV1

  // Optional presentation condition selected for this attempt.
  exerciseCondition?: ExerciseConditionV1

  // Optional policy metadata explaining why the condition was selected.
  reviewPolicyDecision?: ReviewPolicyDecisionV1

  // Versioned derived evidence snapshot. Raw telemetry/context remain the source of truth.
  reviewEvidence?: ReviewEvidenceV1

  // Shadow-only proposal for the next exercise; never applied to this attempt.
  reviewPolicyShadow?: ReviewPolicyShadowV1

  // Explicit product provenance. Legacy records may omit these fields.
  sourceMode?: 'typing' | 'learn'
  learnItemKind?: LearnSessionKind
}

export interface LetterMistakes {
  // 每个字母被错误输入成什么, index 为字母的索引, 数组内为错误的 e.key
  [index: number]: string[]
}

export class WordRecord implements IWordRecord {
  id?: number
  word: string
  timeStamp: number
  dict: string
  chapter: number | null
  timing: number[]
  wrongCount: number
  mistakes: LetterMistakes
  typingTelemetry?: WordRecordTelemetry
  learningContext?: LearningContextV1
  exerciseCondition?: ExerciseConditionV1
  reviewPolicyDecision?: ReviewPolicyDecisionV1
  reviewEvidence?: ReviewEvidenceV1
  reviewPolicyShadow?: ReviewPolicyShadowV1
  sourceMode?: 'typing' | 'learn'
  learnItemKind?: LearnSessionKind

  constructor(
    word: string,
    dict: string,
    chapter: number | null,
    timing: number[],
    wrongCount: number,
    mistakes: LetterMistakes,
    telemetry?: WordRecordTelemetry,
    learningContext?: LearningContextV1,
    exerciseCondition?: ExerciseConditionV1,
    reviewPolicyDecision?: ReviewPolicyDecisionV1,
    reviewEvidence?: ReviewEvidenceV1,
    reviewPolicyShadow?: ReviewPolicyShadowV1,
    sourceMode?: 'typing' | 'learn',
    learnItemKind?: LearnSessionKind,
  ) {
    this.word = word
    this.timeStamp = getUTCUnixTimestamp()
    this.dict = dict
    this.chapter = chapter
    this.timing = timing
    this.wrongCount = wrongCount
    this.mistakes = mistakes

    if (telemetry) {
      this.typingTelemetry = telemetry
    }
    if (learningContext) {
      this.learningContext = learningContext
    }
    if (exerciseCondition) {
      this.exerciseCondition = exerciseCondition
    }
    if (reviewPolicyDecision) {
      this.reviewPolicyDecision = reviewPolicyDecision
    }
    if (reviewEvidence) {
      this.reviewEvidence = reviewEvidence
    }
    if (reviewPolicyShadow) {
      this.reviewPolicyShadow = reviewPolicyShadow
    }
    if (sourceMode) {
      this.sourceMode = sourceMode
    }
    if (learnItemKind) {
      this.learnItemKind = learnItemKind
    }
  }

  get totalTime() {
    return this.timing.reduce((acc, curr) => acc + curr, 0)
  }
}

export interface IChapterRecord {
  // 正常章节为 dictKey, 其他功能则为对应的类型
  dict: string
  // 在错题场景中为 -1
  chapter: number | null
  timeStamp: number
  // 单位为 s，章节的记录没必要到毫秒级
  time: number
  // 正确按键次数，输对一个字母即记录
  correctCount: number
  // 错误的按键次数。 出错会清空整个输入，但只记录一次错误
  wrongCount: number
  // 用户输入的单词总数，可能会使用循环等功能使输入总数大于 20
  wordCount: number
  // 一次打对未犯错的单词列表, 可以和 wordNumber 对比得出出错的单词 indexes
  correctWordIndexes: number[]
  // 章节总单词数
  wordNumber: number
  // 单词 record 的 id 列表
  wordRecordIds: number[]
}

export class ChapterRecord implements IChapterRecord {
  dict: string
  chapter: number | null
  timeStamp: number
  time: number
  correctCount: number
  wrongCount: number
  wordCount: number
  correctWordIndexes: number[]
  wordNumber: number
  wordRecordIds: number[]

  constructor(
    dict: string,
    chapter: number | null,
    time: number,
    correctCount: number,
    wrongCount: number,
    wordCount: number,
    correctWordIndexes: number[],
    wordNumber: number,
    wordRecordIds: number[],
  ) {
    this.dict = dict
    this.chapter = chapter
    this.timeStamp = getUTCUnixTimestamp()
    this.time = time
    this.correctCount = correctCount
    this.wrongCount = wrongCount
    this.wordCount = wordCount
    this.correctWordIndexes = correctWordIndexes
    this.wordNumber = wordNumber
    this.wordRecordIds = wordRecordIds
  }

  get wpm() {
    return Math.round((this.wordCount / this.time) * 60)
  }

  get inputAccuracy() {
    return Math.round((this.correctCount / this.correctCount + this.wrongCount) * 100)
  }

  get wordAccuracy() {
    return Math.round((this.correctWordIndexes.length / this.wordNumber) * 100)
  }
}

export interface IReviewRecord {
  id?: number
  dict: string
  // 当前练习进度
  index: number
  // 创建时间
  createTime: number
  // 是否已经完成
  isFinished: boolean
  // 单词列表, 根据复习算法生成和修改，可能会有重复值
  words: Word[]
  // Frozen at session creation from the latest shadow proposal per word.
  exercisePlans?: Record<string, ReviewExercisePlanV1>
  // Persisted same-session reinforcement budget consumption per word.
  // A value of 1 means this Review session has already inserted its one
  // allowed reinforcement occurrence for the word.
  reinforcementCounts?: Record<string, number>
  // Transitional Learn session classification. Legacy absence means review.
  sessionKind?: LearnSessionKind
}

export class ReviewRecord implements IReviewRecord {
  id?: number
  dict: string
  index: number
  createTime: number
  isFinished: boolean
  words: Word[]
  exercisePlans?: Record<string, ReviewExercisePlanV1>
  reinforcementCounts?: Record<string, number>
  sessionKind?: LearnSessionKind

  constructor(
    dict: string,
    words: Word[],
    exercisePlans?: Record<string, ReviewExercisePlanV1>,
    sessionKind: LearnSessionKind = 'review',
  ) {
    this.dict = dict
    this.index = 0
    this.createTime = getUTCUnixTimestamp()
    this.words = words
    this.isFinished = false
    this.sessionKind = sessionKind
    if (exercisePlans && Object.keys(exercisePlans).length > 0) {
      this.exercisePlans = exercisePlans
    }
  }
}

export interface IRevisionDictRecord {
  dict: string
  revisionIndex: number
  createdTime: number
}

export class RevisionDictRecord implements IRevisionDictRecord {
  dict: string
  revisionIndex: number
  createdTime: number

  constructor(dict: string, revisionIndex: number, createdTime: number) {
    this.dict = dict
    this.revisionIndex = revisionIndex
    this.createdTime = createdTime
  }
}

export interface IRevisionWordRecord {
  word: string
  timeStamp: number
  dict: string
  errorCount: number
}

export class RevisionWordRecord implements IRevisionWordRecord {
  word: string
  timeStamp: number
  dict: string
  errorCount: number

  constructor(word: string, dict: string, errorCount: number) {
    this.word = word
    this.timeStamp = getUTCUnixTimestamp()
    this.dict = dict
    this.errorCount = errorCount
  }
}
