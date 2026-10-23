import type {
  IChapterRecord,
  IReviewRecord,
  IRevisionDictRecord,
  IWordRecord,
} from './record'
import { ChapterRecord, ReviewRecord, WordRecord } from './record'
import type {
  AchievementEventRecord,
  AchievementStateRecord,
} from '@/achievement/types'
import type { IReviewWordState } from '@/review/types'
import Dexie from 'dexie'
import type { Table } from 'dexie'

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
      wordRecords:
        '++id,word,timeStamp,dict,chapter,errorCount,[dict+chapter]',
      chapterRecords:
        '++id,timeStamp,dict,chapter,time,[dict+chapter]',
    })
    this.version(2).stores({
      wordRecords:
        '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords:
        '++id,timeStamp,dict,chapter,time,[dict+chapter]',
    })
    this.version(3).stores({
      wordRecords:
        '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords:
        '++id,timeStamp,dict,chapter,time,[dict+chapter]',
      reviewRecords: '++id,dict,createTime,isFinished',
    })
    this.version(4).stores({
      wordRecords:
        '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords:
        '++id,timeStamp,dict,chapter,time,[dict+chapter]',
      reviewRecords: '++id,dict,createTime,isFinished',
      reviewWordStates:
        '++id,&[dict+word],dict,word,nextReviewAt,[dict+nextReviewAt],lastReviewedAt',
    })
    this.version(5).stores({
      wordRecords:
        '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords:
        '++id,timeStamp,dict,chapter,time,[dict+chapter]',
      reviewRecords: '++id,dict,createTime,isFinished',
      reviewWordStates:
        '++id,&[dict+word],dict,word,nextReviewAt,[dict+nextReviewAt],lastReviewedAt',
      achievementEvents: '&eventId,sourceRecordId,occurredAt,dict,word',
      achievementStates: '&achievementId,unlockedAt,seenAt',
    })

    // S1 rollout barrier: opening the newer schema triggers an IndexedDB
    // versionchange in already-open V5 clients. Dexie closes old connections;
    // any V5 client that tries to reopen receives VersionError instead of
    // silently writing into a newly isolated working workspace. No table
    // contents are changed by this schema-only upgrade.
    this.version(6).stores({
      wordRecords:
        '++id,word,timeStamp,dict,chapter,wrongCount,[dict+chapter]',
      chapterRecords:
        '++id,timeStamp,dict,chapter,time,[dict+chapter]',
      reviewRecords: '++id,dict,createTime,isFinished',
      reviewWordStates:
        '++id,&[dict+word],dict,word,nextReviewAt,[dict+nextReviewAt],lastReviewedAt',
      achievementEvents: '&eventId,sourceRecordId,occurredAt,dict,word',
      achievementStates: '&achievementId,unlockedAt,seenAt',
    })
  }
}

export const db = new RecordDB()

/**
 * Keep mapped read/export semantics identical between the live RecordDB and
 * the isolated M4 candidate materialization database. Dexie export's Typeson
 * userObject markers depend on these class mappings, not only table schema.
 */
export function applyRecordClassMappings(target: Dexie): void {
  target.table('wordRecords').mapToClass(WordRecord)
  target.table('chapterRecords').mapToClass(ChapterRecord)
  target.table('reviewRecords').mapToClass(ReviewRecord)
}

applyRecordClassMappings(db)
