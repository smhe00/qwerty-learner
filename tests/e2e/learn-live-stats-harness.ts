// Browser fixture for TASK-20261007-008.
//
// The Learn live strip reconstructs 新学 / 已复习 / 独立回忆 from persisted
// WordRecords. Seeding that evidence needs the real Dexie schema, so the
// harness runs inside the page instead of poking IndexedDB from the test
// process. It only writes fixtures; it never asserts product behaviour.

import { db } from '../../src/utils/db'
import type { IReviewRecord, IWordRecord } from '../../src/utils/db/record'
import type { Word } from '../../src/typings'

type SeedWordRecord = {
  word: string
  timeStamp: number
  dict?: string
  sourceMode?: 'typing' | 'learn'
  learnItemKind?: 'review' | 'acquisition'
  retrievalValidity?: 'independent' | 'assisted' | 'uncertain' | 'unknown'
  errorCause?: 'clean' | 'recall' | 'spelling' | 'motor' | 'uncertain'
}

type SeedInput = {
  dict: string
  session: {
    id?: number
    createTime: number
    index?: number
    isFinished?: boolean
    words: string[]
    sessionKind?: 'review' | 'acquisition' | 'mixed'
    itemKinds?: Record<string, 'review' | 'acquisition'>
    itemStates?: IReviewRecord['itemStates']
    acquisitionStates?: IReviewRecord['acquisitionStates']
  }
  wordRecords?: SeedWordRecord[]
}

function toWord(name: string): Word {
  return { name, trans: [`${name}-translation`], usphone: '', ukphone: '' }
}

async function clearAllTables() {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()))
  })
}

async function seed(input: SeedInput) {
  await clearAllTables()

  const records: IWordRecord[] = (input.wordRecords ?? []).map((entry) => ({
    word: entry.word,
    timeStamp: entry.timeStamp,
    dict: entry.dict ?? input.dict,
    chapter: -1,
    timing: [],
    wrongCount: 0,
    mistakes: [],
    sourceMode: entry.sourceMode ?? 'learn',
    ...(entry.learnItemKind ? { learnItemKind: entry.learnItemKind } : {}),
    ...(entry.retrievalValidity || entry.errorCause
      ? {
          reviewEvidence: {
            version: 1 as const,
            memoryGrade: 'good',
            errorCause: entry.errorCause ?? 'clean',
            confidence: 1,
            evidenceStrength: 1,
            retrievalValidity: entry.retrievalValidity ?? 'unknown',
            reasonCodes: ['harness-fixture'],
          },
        }
      : {}),
  }))

  if (records.length > 0) {
    await db.wordRecords.bulkAdd(records)
  }

  const reviewRecord: IReviewRecord = {
    dict: input.dict,
    index: input.session.index ?? 0,
    createTime: input.session.createTime,
    isFinished: input.session.isFinished ?? false,
    words: input.session.words.map(toWord),
    ...(input.session.id !== undefined ? { id: input.session.id } : {}),
    ...(input.session.sessionKind
      ? { sessionKind: input.session.sessionKind }
      : {}),
    ...(input.session.itemKinds ? { itemKinds: input.session.itemKinds } : {}),
    ...(input.session.itemStates
      ? { itemStates: input.session.itemStates }
      : {}),
    ...(input.session.acquisitionStates
      ? { acquisitionStates: input.session.acquisitionStates }
      : {}),
  }

  localStorage.setItem('currentDict', JSON.stringify(input.dict))
  localStorage.setItem('currentChapter', JSON.stringify(-1))
  localStorage.setItem(
    'reviewModeInfo',
    JSON.stringify({ isReviewMode: true, reviewRecord }),
  )

  return {
    wordRecords: records.length,
    sessionWords: reviewRecord.words.length,
  }
}

async function readSeededWordRecords() {
  return (await db.wordRecords.toArray()).map((record) => ({
    word: record.word,
    dict: record.dict,
    timeStamp: record.timeStamp,
    sourceMode: record.sourceMode ?? null,
    learnItemKind: record.learnItemKind ?? null,
    retrievalValidity: record.reviewEvidence?.retrievalValidity ?? null,
    errorCause: record.reviewEvidence?.errorCause ?? null,
  }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(window as any).__learnLiveStatsHarness = {
  seed,
  clearAllTables,
  readSeededWordRecords,
}
