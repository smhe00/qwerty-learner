/**
 * Automatic same-account reconciliation of decoded IndexedDB records.
 * Numeric keys are transport-local. UUID facts are deduplicated only by UUID.
 * Legacy exact-payload matches use max multiplicity; originals MUST be archived.
 * No invented attempt IDs, no new awards, no combination of session cursors.
 */
import { rebuildActiveFsrsStateFromWordRecords } from '@/review/fsrs/active'
import { isLearningAttemptId } from '@/utils/db/attempt-identity'
import type { IWordRecord } from '@/utils/db/record'

export type MergeRow = Record<string, any>
export const AUTO_MERGE_TABLES = [
  'wordRecords',
  'chapterRecords',
  'reviewRecords',
  'reviewWordStates',
  'achievementEvents',
  'achievementStates',
] as const
export type MergeTables = Record<(typeof AUTO_MERGE_TABLES)[number], MergeRow[]>

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const validId = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) > 0

/** Bounded structural key, including aliases, sparse arrays and IDB values. */
export function mergeValueKey(value: unknown): string {
  const seen = new Map<object, number>()
  let nodes = 0
  const walk = (v: any, depth: number): unknown => {
    if (++nodes > 2_000_000 || depth > 100) throw Error('auto-merge-value-budget')
    if (v === undefined) return ['undefined']
    if (v === null) return ['null']
    if (typeof v === 'number') return ['number', Object.is(v, -0) ? '-0' : String(v)]
    if (['string', 'boolean', 'bigint'].includes(typeof v)) return [typeof v, String(v)]
    if (typeof v !== 'object') throw Error('auto-merge-unsupported-value')
    const prior = seen.get(v)
    if (prior !== undefined) return ['ref', prior]
    const id = seen.size
    seen.set(v, id)
    if (v instanceof Date) return ['date', id, v.getTime()]
    if (v instanceof RegExp) return ['regexp', id, v.source, v.flags]
    if (v instanceof ArrayBuffer) return ['buffer', id, Array.from(new Uint8Array(v))]
    if (ArrayBuffer.isView(v)) return ['view', id, v.constructor.name, v.byteOffset, v.byteLength, walk(v.buffer, depth + 1)]
    if (v instanceof Map) return ['map', id, Array.from(v).map(([k, x]) => [walk(k, depth + 1), walk(x, depth + 1)])]
    if (v instanceof Set) return ['set', id, Array.from(v).map((x) => walk(x, depth + 1))]
    const proto = Object.getPrototypeOf(v)
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) {
      throw Error('auto-merge-unknown-value-prototype')
    }
    return [
      Array.isArray(v) ? 'array' : 'object',
      id,
      Array.isArray(v) ? v.length : null,
      Object.keys(v)
        .sort()
        .map((k) => [k, walk(v[k], depth + 1)]),
    ]
  }
  return JSON.stringify(walk(value, 0))
}

function logical(row: MergeRow, word = false): MergeRow {
  const result = structuredClone(row)
  delete result.id
  if (word && result.fsrsShadow?.sourceRecordId !== undefined) {
    result.fsrsShadow.sourceRecordId = 0
  }
  return result
}
function immutableWord(row: MergeRow): string {
  const result = logical(row, true)
  delete result.fsrsShadow
  delete result.reviewPolicyShadow
  return mergeValueKey(result)
}
function rowsChecked(rows: MergeRow[]): MergeRow[] {
  const ids = new Set<number>()
  if (!Array.isArray(rows) || rows.length > 200_000) throw Error('auto-merge-row-budget')
  for (const row of rows) {
    if (!row || !validId(row.id) || ids.has(row.id)) throw Error('auto-merge-invalid-primary-key')
    ids.add(row.id)
  }
  return [...rows].sort((a, b) => a.id - b.id)
}

type NumericResult = { rows: MergeRow[]; maps: [Map<number, number>, Map<number, number>] }
function numericUnion(
  sides: [MergeRow[], MergeRow[]],
  keyOf: (row: MergeRow) => { key: string; stable: boolean },
  resolve?: (a: MergeRow, b: MergeRow) => MergeRow,
  word = false,
): NumericResult {
  const groups = new Map<string, { stable: boolean; sides: [MergeRow[], MergeRow[]] }>()
  sides.forEach((rows, side) => {
    for (const row of rowsChecked(rows)) {
      const identity = keyOf(row)
      const group = groups.get(identity.key) ?? { stable: identity.stable, sides: [[], []] }
      group.sides[side].push(row)
      groups.set(identity.key, group)
    }
  })
  const maps: NumericResult['maps'] = [new Map(), new Map()]
  const rows: MergeRow[] = []
  for (const key of Array.from(groups.keys()).sort(compare)) {
    const group = groups.get(key)!
    if (group.stable && group.sides.some((side) => side.length > 1)) {
      throw Error('auto-merge-duplicate-stable-identity')
    }
    const count = group.stable ? 1 : Math.max(...group.sides.map((side) => side.length))
    for (let i = 0; i < count; i++) {
      const a = group.sides[0][i]
      const b = group.sides[1][i]
      let selected = a ?? b
      if (a && b) {
        if (resolve) selected = resolve(a, b)
        else if (mergeValueKey(logical(a, word)) !== mergeValueKey(logical(b, word))) {
          throw Error('auto-merge-contradictory-immutable-identity')
        }
      }
      const row = structuredClone(selected)
      const id = rows.length + 1
      row.id = id
      if (word && row.fsrsShadow?.sourceRecordId !== undefined) row.fsrsShadow.sourceRecordId = id
      rows.push(row)
      if (a) maps[0].set(a.id, id)
      if (b) maps[1].set(b.id, id)
    }
  }
  return { rows, maps }
}
function exactIdentity(row: MergeRow, field: string, word = false) {
  const uuid = row[field]
  if (uuid !== undefined) {
    if (!isLearningAttemptId(uuid)) throw Error('auto-merge-invalid-stable-identity')
    return { key: 'uuid:' + uuid, stable: true }
  }
  return { key: 'legacy:' + mergeValueKey(logical(row, word)), stable: false }
}
function choose(a: MergeRow, b: MergeRow, score: (r: MergeRow) => number[]): MergeRow {
  const x = score(a)
  const y = score(b)
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return x[i] > y[i] ? a : b
  }
  return compare(mergeValueKey(logical(a)), mergeValueKey(logical(b))) >= 0 ? a : b
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
function referenced(id: unknown, map: Map<number, number>): number {
  if (!validId(id) || !map.has(id)) throw Error('auto-merge-dangling-word-reference')
  return map.get(id)!
}
function remapReferences(source: MergeRow, map: Map<number, number>): MergeRow {
  const row = structuredClone(source)
  if (row.sourceRecordId !== undefined) row.sourceRecordId = referenced(row.sourceRecordId, map)
  if (row.sourceRecordIds !== undefined) {
    if (!Array.isArray(row.sourceRecordIds)) throw Error('auto-merge-invalid-references')
    row.sourceRecordIds = row.sourceRecordIds.map((id: unknown) => referenced(id, map))
  }
  if (row.pendingAwards !== undefined) {
    if (!Array.isArray(row.pendingAwards)) throw Error('auto-merge-invalid-awards')
    row.pendingAwards = row.pendingAwards.map((award: MergeRow) => remapReferences(award, map))
  }
  return row
}
const pair = (row: MergeRow): string => {
  if (typeof row.dict !== 'string' || !row.dict || typeof row.word !== 'string' || !row.word) {
    throw Error('auto-merge-invalid-word-key')
  }
  return JSON.stringify([row.dict, row.word])
}
function statesByWord(rows: MergeRow[]): Map<string, MergeRow> {
  const out = new Map<string, MergeRow>()
  for (const row of rowsChecked(rows)) {
    const key = pair(row)
    if (out.has(key)) throw Error('auto-merge-duplicate-word-state')
    out.set(key, row)
  }
  return out
}

/** Pure candidate construction. Browser adapter owns account/schema/audit/archive gates. */
export function mergeDecodedV4Tables(local: MergeTables, remote: MergeTables): MergeTables {
  const words = numericUnion(
    [local.wordRecords, remote.wordRecords],
    (row) => exactIdentity(row, 'attemptId', true),
    (a, b) => {
      if (immutableWord(a) !== immutableWord(b)) throw Error('auto-merge-contradictory-attempt')
      return compare(mergeValueKey(logical(a, true)), mergeValueKey(logical(b, true))) >= 0 ? a : b
    },
    true,
  )
  const chapters = [local, remote].map((tables, side) =>
    tables.chapterRecords.map((source) => {
      const row = structuredClone(source)
      if (row.wordRecordIds !== undefined) {
        if (!Array.isArray(row.wordRecordIds)) throw Error('auto-merge-invalid-chapter-references')
        row.wordRecordIds = row.wordRecordIds.map((id: unknown) => {
          const next = referenced(id, words.maps[side])
          if (words.rows[next - 1].dict !== row.dict) throw Error('auto-merge-cross-dictionary-reference')
          return next
        })
      }
      return row
    }),
  ) as [MergeRow[], MergeRow[]]
  const chapterRows = numericUnion(chapters, (row) => exactIdentity(row, 'chapterRecordId')).rows
  const reviews = numericUnion(
    [local.reviewRecords, remote.reviewRecords],
    (row) => exactIdentity(row, 'sessionId'),
    (a, b) => {
      if (a.dict !== b.dict || a.createTime !== b.createTime || a.sessionKind !== b.sessionKind) {
        throw Error('auto-merge-session-header-conflict')
      }
      for (const row of [a, b]) {
        if (
          !Array.isArray(row.words) ||
          !Number.isSafeInteger(row.index) ||
          row.index < 0 ||
          (row.index > row.words.length && !(row.isFinished === true && row.words.length === 0))
        ) {
          throw Error('auto-merge-invalid-session-cursor')
        }
      }
      // Choose an actual COMPLETE variant. Never splice item states or add cursors.
      return choose(a, b, (row) => [row.isFinished === true ? 1 : 0, row.index])
    },
  ).rows

  const stateSides = [statesByWord(local.reviewWordStates), statesByWord(remote.reviewWordStates)]
  const wordGroups = new Map<string, MergeRow[]>()
  for (const row of words.rows) {
    const k = pair(row)
    const group = wordGroups.get(k) ?? []
    group.push(row)
    wordGroups.set(k, group)
  }
  const stateRows: MergeRow[] = []
  for (const k of Array.from(
    new Set([...Array.from(stateSides[0].keys()), ...Array.from(stateSides[1].keys()), ...Array.from(wordGroups.keys())]),
  ).sort(compare)) {
    const prior = stateSides.map((side) => side.get(k)).filter((row): row is MergeRow => !!row)
    const excluded = prior.filter((row) => row.lifecycle === 'excluded' || row.exclusion !== undefined)
    const candidates = excluded.length ? excluded : prior
    let selected = candidates.reduce<MergeRow | undefined>(
      (a, b) => (a ? choose(a, b, (r) => [num(r.exclusion?.excludedAt), num(r.updatedAt), num(r.lastReviewedAt), num(r.reviewCount)]) : b),
      undefined,
    )
    const history = wordGroups.get(k) ?? []
    if (!excluded.length) {
      const [dict, word] = JSON.parse(k)
      const replay = history.length ? rebuildActiveFsrsStateFromWordRecords(dict, word, history as unknown as IWordRecord[]) : undefined
      // Sparse historical archives may omit old eligible reviews. Never replace
      // a richer persisted scheduler with an incomplete reconstruction.
      if (
        replay &&
        prior.every((row) => replay.reviewCount >= num(row.reviewCount) && num(replay.lastReviewedAt) >= num(row.lastReviewedAt))
      ) {
        selected = { ...structuredClone(selected ?? {}), ...replay }
      } else if (selected && prior.length > 1) {
        selected = { ...structuredClone(selected), nextReviewAt: Math.min(...prior.map((row) => num(row.nextReviewAt))) }
      }
    }
    if (selected) stateRows.push({ ...structuredClone(selected), id: stateRows.length + 1 })
  }

  const eventMaps = [new Map<string, string>(), new Map<string, string>()]
  const remappedEvents = [local, remote].map((tables, side) =>
    tables.achievementEvents.map((source) => {
      if (typeof source.eventId !== 'string' || !source.eventId) throw Error('auto-merge-invalid-event-id')
      const row = remapReferences(source, words.maps[side])
      const match = /^(word|mastery):([1-9][0-9]*)$/.exec(row.eventId)
      if (match) row.eventId = match[1] + ':' + referenced(Number(match[2]), words.maps[side])
      if (eventMaps[side].has(source.eventId)) throw Error('auto-merge-duplicate-achievement-event')
      eventMaps[side].set(source.eventId, row.eventId)
      return row
    }),
  )
  const trigger = (row: MergeRow, side: number): MergeRow => {
    const originalTrigger = row.firstTriggerEventId
    if (typeof originalTrigger === 'string' && eventMaps[side].has(originalTrigger)) {
      row.firstTriggerEventId = eventMaps[side].get(originalTrigger)
    }
    const legacyTrigger = typeof originalTrigger === 'string' ? /^(word|mastery):([1-9][0-9]*)$/.exec(originalTrigger) : null
    // Even a pruned trigger event must not leave an origin-local numeric key
    // pointing at an unrelated rebased learning record.
    if (legacyTrigger && !eventMaps[side].has(originalTrigger)) {
      row.firstTriggerEventId = legacyTrigger[1] + ':' + referenced(Number(legacyTrigger[2]), words.maps[side])
    }
    return row
  }
  const achievementStates = new Map<string, MergeRow>()
  ;[local, remote].forEach((tables, side) => {
    for (const source of tables.achievementStates) {
      const row = trigger(remapReferences(source, words.maps[side]), side)
      if (typeof row.achievementId !== 'string' || !row.achievementId) throw Error('auto-merge-invalid-achievement')
      const previous = achievementStates.get(row.achievementId)
      if (!previous) achievementStates.set(row.achievementId, row)
      else {
        const selected = choose(previous, row, (r) => [-num(r.unlockedAt)])
        const next = structuredClone(selected)
        for (const field of ['seenAt', 'cultureCardSeenAt']) {
          if (previous[field] !== undefined || row[field] !== undefined) next[field] = Math.max(num(previous[field]), num(row[field]))
        }
        achievementStates.set(row.achievementId, next)
      }
    }
  })
  const events = new Map<string, MergeRow>()
  remappedEvents.forEach((rows, side) => {
    for (const source of rows) {
      const row = structuredClone(source)
      if (row.pendingAwards) row.pendingAwards = row.pendingAwards.map((award: MergeRow) => trigger(award, side))
      const previous = events.get(row.eventId)
      if (!previous) {
        events.set(row.eventId, row)
        continue
      }
      if (
        previous.eventType !== row.eventType ||
        previous.origin !== row.origin ||
        (row.eventType !== 'unlock_queue' &&
          (previous.dict !== row.dict ||
            previous.word !== row.word ||
            previous.occurredAt !== row.occurredAt ||
            previous.sourceRecordId !== row.sourceRecordId))
      ) {
        throw Error('auto-merge-achievement-identity-conflict')
      }
      const next = structuredClone(choose(previous, row, (r) => [num(r.occurredAt)]))
      next.unlockedAchievementIds = Array.from(
        new Set([...(previous.unlockedAchievementIds ?? []), ...(row.unlockedAchievementIds ?? [])]),
      ).sort(compare)
      if (previous.sourceRecordIds || row.sourceRecordIds) {
        next.sourceRecordIds = Array.from(new Set([...(previous.sourceRecordIds ?? []), ...(row.sourceRecordIds ?? [])])).sort(
          (a: number, b: number) => a - b,
        )
      }
      next.metricValues = { ...previous.metricValues, ...row.metricValues }
      for (const metric of Object.keys(next.metricValues)) {
        next.metricValues[metric] = Math.max(num(previous.metricValues?.[metric]), num(row.metricValues?.[metric]))
      }
      if (previous.pendingAwards || row.pendingAwards) {
        const awards = new Map<string, MergeRow>()
        for (const award of [...(previous.pendingAwards ?? []), ...(row.pendingAwards ?? [])]) {
          if (achievementStates.has(award.achievementId)) continue
          const before = awards.get(award.achievementId)
          awards.set(award.achievementId, before ? choose(before, award, (r) => [-num(r.triggeredAt)]) : award)
        }
        next.pendingAwards = Array.from(awards.values()).sort((a, b) => compare(a.achievementId, b.achievementId))
      }
      events.set(row.eventId, next)
    }
  })
  return {
    wordRecords: words.rows,
    chapterRecords: chapterRows,
    reviewRecords: reviews,
    reviewWordStates: stateRows,
    achievementEvents: Array.from(events.values()).sort((a, b) => compare(a.eventId, b.eventId)),
    achievementStates: Array.from(achievementStates.values()).sort((a, b) => compare(a.achievementId, b.achievementId)),
  }
}
