/**
 * M2 immutable ChapterRecord merge with foreign-key rebasing.
 * An origin-local Dexie ID is NOT event identity. UUID identifies newly
 * completed chapters; ancestor legacy rows remain immutable.
 * Pure and read-only. Never authorizes cloud or M4 publication.
 */
import { isLearningAttemptId } from '@/utils/db/attempt-identity'
import { stableWorkspaceJson } from './workspace-v4'

type Row = Record<string, unknown>
type Side = { chapters: readonly Row[]; words: readonly Row[] }
type Input = { ancestor: readonly Row[]; ancestorWords: readonly Row[];
  local: Side; remote: Side; candidateWords: readonly Row[] }
export type ChapterUnionResult =
  | { status: 'merged'; rows: Row[]; publishReady: false; convergenceComplete: false }
  | { status: 'blocked'; reason: string; publishReady: false; convergenceComplete: false }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const json = (x: unknown) => stableWorkspaceJson(x)
function index(rows: readonly Row[]): Map<number, Row> {
  const result = new Map<number, Row>()
  for (const row of rows) {
    if (!Number.isSafeInteger(row.id) || Number(row.id) < 1 ||
        result.has(row.id as number)) {
      throw Error('invalid-or-duplicate-primary-key')
    }
    result.set(row.id as number, row)
  }
  return result
}
export function mergeUuidChapterRecords(input: Input): ChapterUnionResult {
  const fail = (reason: string): ChapterUnionResult => ({
    status: 'blocked', reason, publishReady: false, convergenceComplete: false,
  })
  try {
    const baseline = index(input.ancestor)
    const ancientWords = index(input.ancestorWords)
    const mergedWords = index(input.candidateWords)
    const byUuid = new Map<string, number>()
    for (const [id, word] of mergedWords) {
      if (!isLearningAttemptId(word.attemptId)) continue
      if (byUuid.has(word.attemptId)) throw Error('duplicate-candidate-attempt-uuid')
      byUuid.set(word.attemptId, id)
    }
    const originalChapterUuids = new Set<string>()
    for (const row of input.ancestor) {
      if (row.chapterRecordId === undefined) continue
      if (typeof row.chapterRecordId !== 'string' ||
          !UUID.test(row.chapterRecordId) ||
          originalChapterUuids.has(row.chapterRecordId)) {
        throw Error('invalid-ancestor-chapter-uuid')
      }
      originalChapterUuids.add(row.chapterRecordId)
    }
    const added = new Map<string, Row>()
    for (const side of [input.local, input.remote]) {
      const chapterIndex = index(side.chapters)
      const sourceWords = index(side.words)
      for (const [id, row] of baseline) {
        if (!chapterIndex.has(id) || json(chapterIndex.get(id)) !== json(row)) {
          throw Error('ancestor-chapter-deleted-or-rewritten')
        }
      }
      for (const row of side.chapters) {
        if (baseline.has(row.id as number)) continue
        const uuid = row.chapterRecordId
        if (typeof uuid !== 'string' || !UUID.test(uuid) ||
            originalChapterUuids.has(uuid) ||
            typeof row.dict !== 'string' || !row.dict ||
            !Array.isArray(row.wordRecordIds)) {
          throw Error('new-chapter-lacks-valid-immutable-identity')
        }
        const remapped: number[] = []
        for (const wordId of row.wordRecordIds) {
          if (!Number.isSafeInteger(wordId) || wordId < 1) {
            throw Error('invalid-chapter-word-reference')
          }
          const source = sourceWords.get(wordId)
          if (!source) throw Error('dangling-source-word-reference')
          let target: number | undefined
          if (isLearningAttemptId(source.attemptId)) {
            target = byUuid.get(source.attemptId)
          } else if (ancientWords.has(wordId) &&
              json(ancientWords.get(wordId)) === json(source)) {
            target = wordId
          }
          const candidate = target === undefined ? null : mergedWords.get(target)
          if (!candidate || source.dict !== candidate.dict ||
              source.word !== candidate.word || row.dict !== source.dict) {
            throw Error('wrong-or-unmapped-merged-word-reference')
          }
          remapped.push(target!)
        }
        const { id: _originId, ...logical } = structuredClone(row)
        logical.wordRecordIds = remapped
        const previous = added.get(uuid)
        if (previous && json(previous) !== json(logical)) {
          throw Error('contradictory-chapter-uuid')
        }
        added.set(uuid, logical)
      }
    }
    const rows = input.ancestor.map(row => structuredClone(row))
    let nextId = Math.max(0, ...baseline.keys())
    for (const uuid of [...added.keys()].sort()) {
      rows.push({ ...added.get(uuid)!, id: ++nextId })
    }
    return { status: 'merged', rows, publishReady: false, convergenceComplete: false }
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'unknown-chapter-error')
  }
}
