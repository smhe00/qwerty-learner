/**
 * M2.1 read-only foreign-key repair proof for cross-device V4 evidence.
 * Does NOT mutate IndexedDB, reconcile control-plane tables, or grant
 * permission to restore/publish a Backup V4.
 */
import { isLearningAttemptId } from '@/utils/db/attempt-identity'
import type { IChapterRecord, IWordRecord } from '@/utils/db/record'
import type {
  AchievementEventRecord,
  AchievementStateRecord,
} from '@/achievement/types'
import { stableWorkspaceJson } from './workspace-v4'
import { preflightAttemptIdentity } from './v4-merge-preflight'

type TaggedSource = {
  words: readonly IWordRecord[]
  chapters: readonly (IChapterRecord & { id?: number })[]
  events: readonly AchievementEventRecord[]
  states: readonly AchievementStateRecord[]
}

type RekeyedChapter = IChapterRecord & { id: number }
type RekeyResult =
  | { status: 'blocked'; publishReady: false; reason: string }
  | {
    status: 'projected'
    publishReady: false
    words: IWordRecord[]
    chapters: RekeyedChapter[]
    events: AchievementEventRecord[]
    states: AchievementStateRecord[]
    /** Rows are projected without changes to either source snapshot. */
    stats: { uniqueAttempts: number; chapterRows: number; achievementEvents: number }
  }

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const fail = (reason: string): RekeyResult =>
  ({ status: 'blocked', publishReady: false, reason })

const validId = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0

function validatedSource(source: TaggedSource): Map<number, string> {
  const ids = new Map<number, string>()
  for (const row of source.words) {
    if (!validId(row.id) || !isLearningAttemptId(row.attemptId) ||
        ids.has(row.id)) throw new Error('invalid-word-identity')
    ids.set(row.id, row.attemptId)
  }
  return ids
}

function remapReference(
  id: number,
  sourceIdToUuid: Map<number, string>,
  uuidToNewId: Map<string, number>,
): number {
  const uuid = sourceIdToUuid.get(id)
  const newId = uuid ? uuidToNewId.get(uuid) : undefined
  if (newId === undefined) throw new Error('dangling-word-reference')
  return newId
}

/** Source-side namespacing before merging, followed by collision checks. */
function rekeyEventId(
  original: string, sourceIdToUuid: Map<number, string>,
): string {
  const match = /^(word|mastery):([1-9]\d*)$/.exec(original)
  if (!match) return original
  const uuid = sourceIdToUuid.get(Number(match[2]))
  if (!uuid) throw new Error('dangling-achievement-event')
  return match[1] + ':' + uuid
}

function rekeyEvent(
  row: AchievementEventRecord,
  sourceIdToUuid: Map<number, string>,
  uuidToNewId: Map<string, number>,
): AchievementEventRecord {
  if (typeof row.eventId !== 'string' || !row.eventId) {
    throw new Error('invalid-achievement-event')
  }
  return {
    ...row,
    eventId: rekeyEventId(row.eventId, sourceIdToUuid),
    ...(row.sourceRecordId === undefined ? {} : {
      sourceRecordId: remapReference(row.sourceRecordId, sourceIdToUuid, uuidToNewId),
    }),
    ...(row.sourceRecordIds === undefined ? {} : {
      sourceRecordIds: row.sourceRecordIds.map(
        id => remapReference(id, sourceIdToUuid, uuidToNewId)),
    }),
    unlockedAchievementIds: [...row.unlockedAchievementIds],
    metricValues: { ...row.metricValues },
  }
}

function rekeyState(
  row: AchievementStateRecord,
  sourceIdToUuid: Map<number, string>,
  uuidToNewId: Map<string, number>,
): AchievementStateRecord {
  return {
    ...row,
    firstTriggerEventId: rekeyEventId(row.firstTriggerEventId, sourceIdToUuid),
    ...(row.sourceRecordId === undefined ? {} : {
      sourceRecordId: remapReference(row.sourceRecordId, sourceIdToUuid, uuidToNewId),
    }),
  }
}

export function projectV4ForeignKeys(input: {
  local: TaggedSource
  remote: TaggedSource
}): RekeyResult {
  const { local, remote } = input
  const p = preflightAttemptIdentity({ local: local.words, remote: remote.words })
  if (!p.safeEventIdentity) {
    return fail(p.identityConflicts ? 'contradictory-attempt' : 'unanchored-legacy')
  }
  try {
    const left = validatedSource(local)
    const right = validatedSource(remote)
    const union = new Map<string, IWordRecord>()
    for (const source of [local, remote]) {
      for (const row of source.words) {
        if (!row.attemptId) throw new Error('unanchored-legacy')
        if (!union.has(row.attemptId)) union.set(row.attemptId, row)
      }
    }
    const sorted = [...union.values()].sort((a, b) =>
      cmp(a.dict, b.dict) || cmp(a.word, b.word) ||
      a.timeStamp - b.timeStamp || cmp(a.attemptId || '', b.attemptId || ''))
    const uuidToNewId = new Map(sorted.map((row, i) => [row.attemptId as string, i + 1]))
    const words = sorted.map((row, i) => {
      const result = { ...row, id: i + 1 }
      // A shadow's numeric record reference must always follow the primary key.
      if (row.fsrsShadow) {
        if (row.fsrsShadow.sourceRecordId !== undefined &&
            row.fsrsShadow.sourceRecordId !== row.id) {
          throw new Error('broken-fsrs-shadow-reference')
        }
        result.fsrsShadow = { ...row.fsrsShadow, sourceRecordId: i + 1 }
      }
      return result
    })

    const chapters: RekeyedChapter[] = []
    const events = new Map<string, AchievementEventRecord>()
    const states = new Map<string, AchievementStateRecord>()
    // Chapter rows lack stable cross-device identity: preserve each separately
    // rather than deduplicate on timestamp, or accidentally overwrite local IDs.
    // This can double-count a shared historic chapter, hence publishReady=false.
    for (const [source, ids] of [[local, left], [remote, right]] as const) {
      for (const chapter of source.chapters) {
        if (!Array.isArray(chapter.wordRecordIds)) throw new Error('invalid-chapter')
        chapters.push({
          ...chapter,
          id: chapters.length + 1,
          wordRecordIds: chapter.wordRecordIds.map(
            id => remapReference(id, ids, uuidToNewId)),
        })
      }
      for (const event of source.events) {
        const next = rekeyEvent(event, ids, uuidToNewId)
        const previous = events.get(next.eventId)
        if (previous && stableWorkspaceJson(previous) !== stableWorkspaceJson(next)) {
          throw new Error('contradictory-achievement-event')
        }
        events.set(next.eventId, next)
      }
      for (const state of source.states) {
        const next = rekeyState(state, ids, uuidToNewId)
        const previous = states.get(next.achievementId)
        if (previous && stableWorkspaceJson(previous) !== stableWorkspaceJson(next)) {
          throw new Error('contradictory-achievement-state')
        }
        states.set(next.achievementId, next)
      }
    }
    for (const state of states.values()) {
      if (!events.has(state.firstTriggerEventId)) {
        throw new Error('dangling-achievement-trigger')
      }
    }
    for (const event of events.values()) {
      for (const achievementId of event.unlockedAchievementIds) {
        const state = states.get(achievementId)
        if (!state || state.firstTriggerEventId !== event.eventId) {
          throw new Error('inconsistent-achievement-unlock')
        }
      }
    }
    return {
      status: 'projected', publishReady: false, words, chapters,
      events: [...events.values()].sort((a, b) => cmp(a.eventId, b.eventId)),
      states: [...states.values()].sort((a, b) => cmp(a.achievementId, b.achievementId)),
      stats: { uniqueAttempts: words.length, chapterRows: chapters.length,
        achievementEvents: events.size },
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'invalid-foreign-keys')
  }
}
