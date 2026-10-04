import type {
  IChapterRecord,
  IReviewRecord,
  IRevisionDictRecord,
  IWordRecord,
  LearningContextV1,
  LetterMistakes,
  WordRecordTelemetry,
} from './record'
import { ChapterRecord, ReviewRecord, WordRecord } from './record'
import { getAchievementSessionId } from '@/achievement/session'
import type { AchievementEventRecord, AchievementStateRecord } from '@/achievement/types'
import type { LearnSessionKind } from '@/learn/session'
import type { ExerciseConditionV1 } from '@/review/condition'
import type { ReviewPolicyDecisionV1, ReviewPolicyShadowV1 } from '@/review/decision'
import type { ReviewEvidenceV1 } from '@/review/evidence'
import type { RatingDecision } from '@/review/state-machine'
import type { IReviewWordState } from '@/review/types'
import { TypingContext, TypingStateActionType } from '@/pages/Typing/store'
import type { TypingState } from '@/pages/Typing/store/type'
import {
  currentChapterAtom,
  currentDictIdAtom,
  isReviewModeAtom,
  reviewModeInfoAtom,
} from '@/store'
import type { Table } from 'dexie'
import Dexie from 'dexie'
import { useAtomValue } from 'jotai'
import { useCallback, useContext } from 'react'

class RecordDB extends Dexie {
  wordRecords!: Table<IWordRecord, number>
  chapterRecords!: Table<IChapterRecord, number>
  reviewRecords!: Table<IReviewRecord, number>
  reviewWordStates!: Table<IReviewWordState, number>
  achievementEvents!: Table<AchievementEventRecord, string>
  achievementStates!: Table<AchievementStateRecord, string>

  revisionDictRecords!: Table<IRevisionDictRecord, number>
  revisionWordRecords!: Table<IWordRecord, number>

  constructor() {
    super('RecordDB')
    this.version(1).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,errorCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
    })
    this.version(2).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
    })
    this.version(3).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
      reviewRecords: '++id,dict,createTime,isFinished',
    })
    this.version(4).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
      reviewRecords: '++id,dict,createTime,isFinished',
      reviewWordStates: '++id,&[dict+word],dict,word,nextReviewAt,[dict+nextReviewAt],lastReviewedAt',
    })
    this.version(5).stores({
      wordRecords: '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords: '++id,timeStamp,dict,chapter,time,[dict+chapter]',
      reviewRecords: '++id,dict,createTime,isFinished',
      reviewWordStates: '++id,&[dict+word],dict,word,nextReviewAt,[dict+nextReviewAt],lastReviewedAt',
      achievementEvents: '&eventId,sourceRecordId,occurredAt,dict,word',
      achievementStates: '&achievementId,unlockedAt,seenAt',
    })
  }
}

export const db = new RecordDB()

db.wordRecords.mapToClass(WordRecord)
db.chapterRecords.mapToClass(ChapterRecord)
db.reviewRecords.mapToClass(ReviewRecord)

export function useSaveChapterRecord() {
  const currentChapter = useAtomValue(currentChapterAtom)
  const isRevision = useAtomValue(isReviewModeAtom)
  const dictID = useAtomValue(currentDictIdAtom)

  const saveChapterRecord = useCallback(
    (typingState: TypingState) => {
      const {
        chapterData: { correctCount, wrongCount, userInputLogs, wordCount, words, wordRecordIds },
        timerData: { time },
      } = typingState
      const correctWordIndexes = userInputLogs.filter((log) => log.correctCount > 0 && log.wrongCount === 0).map((log) => log.index)

      const chapterRecord = new ChapterRecord(
        dictID,
        isRevision ? -1 : currentChapter,
        time,
        correctCount,
        wrongCount,
        wordCount,
        correctWordIndexes,
        words.length,
        wordRecordIds ?? [],
      )
      db.chapterRecords.add(chapterRecord)
    },
    [currentChapter, dictID, isRevision],
  )

  return saveChapterRecord
}

export type WordKeyLogger = {
  letterTimeArray: number[]
  letterMistake: LetterMistakes
}

export function useSaveWordRecord() {
  const isRevision = useAtomValue(isReviewModeAtom)
  const currentChapter = useAtomValue(currentChapterAtom)
  const dictID = useAtomValue(currentDictIdAtom)
  const reviewModeInfo = useAtomValue(reviewModeInfoAtom)
  const activeLearnSessionId = reviewModeInfo.reviewRecord
    ? getAchievementSessionId(reviewModeInfo.reviewRecord)
    : undefined

  const { dispatch } = useContext(TypingContext) ?? {}

  const saveWordRecord = useCallback(
    async ({
      word,
      wrongCount,
      letterTimeArray,
      letterMistake,
      telemetry,
      learningContext,
      exerciseCondition,
      reviewPolicyDecision,
      reviewEvidence,
      reviewRatingDecision,
      reviewPolicyShadow,
      sourceMode,
      learnItemKind,
    }: {
      word: string
      wrongCount: number
      letterTimeArray: number[]
      letterMistake: LetterMistakes
      telemetry?: WordRecordTelemetry
      learningContext?: LearningContextV1
      exerciseCondition?: ExerciseConditionV1
      reviewPolicyDecision?: ReviewPolicyDecisionV1
      reviewEvidence?: ReviewEvidenceV1
      reviewRatingDecision?: RatingDecision
      reviewPolicyShadow?: ReviewPolicyShadowV1
      sourceMode?: 'typing' | 'learn'
      learnItemKind?: LearnSessionKind
    }) => {
      const timing = []
      for (let i = 1; i < letterTimeArray.length; i++) {
        const diff = letterTimeArray[i] - letterTimeArray[i - 1]
        timing.push(diff)
      }

      const wordRecord = new WordRecord(
        word,
        dictID,
        isRevision ? -1 : currentChapter,
        timing,
        wrongCount,
        letterMistake,
        telemetry,
        learningContext,
        exerciseCondition,
        reviewPolicyDecision,
        reviewEvidence,
        reviewRatingDecision,
        reviewPolicyShadow,
        sourceMode,
        learnItemKind,
      )

      let dbID = -1
      try {
        dbID = await db.wordRecords.add(wordRecord)
      } catch (e) {
        console.error(e)
      }
      if (dispatch) {
        dbID > 0 && dispatch({ type: TypingStateActionType.ADD_WORD_RECORD_ID, payload: dbID })
      }

      // Achievement is an additive sidecar. It only runs after raw Learn
      // evidence is durable, never participates in the scheduler transaction,
      // and a failure here must not block word progression.
      if (dbID > 0 && sourceMode === 'learn') {
        void import('@/achievement/engine')
          .then(({ processLiveLearnWordRecord }) =>
            processLiveLearnWordRecord(dbID, {
              sessionId: activeLearnSessionId,
            }),
          )
          .catch((error) => {
            console.error('failed to process achievement event', error)
          })
      }

      return dbID
    },
    [
      activeLearnSessionId,
      currentChapter,
      dictID,
      dispatch,
      isRevision,
    ],
  )

  return saveWordRecord
}

export function useDeleteWordRecord() {
  const deleteWordRecord = useCallback(async (word: string, dict: string) => {
    try {
      const deletedCount = await db.wordRecords.where({ word, dict }).delete()
      return deletedCount
    } catch (error) {
      console.error(`删除单词记录时出错：`, error)
    }
  }, [])

  return { deleteWordRecord }
}
