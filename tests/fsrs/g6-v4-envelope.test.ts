/**
 * G6-2b: research-only Backup V4 envelope oracle for additive native FSRS
 * card fields. It NEVER calls the import/restore path or IndexedDB.
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { Rating } from 'ts-fsrs'
import {
  createWorkspaceV4,
  parseWorkspaceV4,
  assertRestorableWorkspaceV4,
  workspaceFingerprintV4,
  stableWorkspaceJson,
  REQUIRED_RESTORABLE_V4_TABLES,
  type WorkspaceDataV4,
} from '../../src/sync/workspace-v4'
import { G6_PROFILES, replayG6Card, type G6Context, type G6ResearchEvent } from './g6-replay-adapter'

const t0 = Date.parse('2026-10-16T08:00:00.000Z')
const context: G6Context = {
  workspaceId: 'research-account',
  dict: 'test-dict',
  word: 'necessary',
  seedAtMs: t0,
}
const events: G6ResearchEvent[] = [
  { eventId: 'attempt-1', attemptId: 'attempt-1',
    workspaceId: context.workspaceId, dict: context.dict, word: context.word,
    occurredAtMs: t0, role: 'long-term-independent', eligible: true, rating: Rating.Good },
  { eventId: 'attempt-2', attemptId: 'attempt-2',
    workspaceId: context.workspaceId, dict: context.dict, word: context.word,
    occurredAtMs: t0 + 4 * 86_400_000, role: 'long-term-independent',
    eligible: true, rating: Rating.Again },
]
function v4Payload(withNative: boolean): WorkspaceDataV4 {
  const study = replayG6Card(context, G6_PROFILES[2], events).snapshot
  const entry = {
    id: 1, dict: context.dict, word: context.word,
    nextReviewAt: Math.floor(Date.parse(study.card.due) / 1000),
    schedulerState: {
      kind: 'fsrs6',
      difficulty: study.card.difficulty, stability: study.card.stability,
      parameterSetId: 'g6-research-experiment-v1',
      ...(withNative ? { nativeResearchCard: study } : {}),
    },
  }
  return {
    database: {
      formatName: 'dexie',
      data: {
        tables: REQUIRED_RESTORABLE_V4_TABLES.map(name => ({ name, schema: '' })),
        data: REQUIRED_RESTORABLE_V4_TABLES.map(name => ({
          tableName: name,
          rows: name === 'reviewWordStates' ? [entry] : [],
        })),
      },
    },
    learnRuntime: { dailySessions: {} },
    settings: { version: 1, values: {} },
    navigation: { currentDict: context.dict, currentChapter: 0 },
  }
}
const metadata = { createdAt: '2026-10-16T08:00:00.000Z',
  source: { kind: 'account' as const, accountId: context.workspaceId } }

test('G6-2b: complete V4 backup envelope preserves an additive native FSRS card on JSON roundtrip', () => {
  const v4 = createWorkspaceV4(v4Payload(true), metadata)
  assertRestorableWorkspaceV4(v4)
  const parsed = parseWorkspaceV4(JSON.stringify(v4))
  assertRestorableWorkspaceV4(parsed)
  assert.deepEqual(parsed, v4)
  const data = parsed.workspaceData.database as { data: { data: Array<{ tableName: string; rows: unknown[] }> } }
  const rows = data.data.data.find(x => x.tableName === 'reviewWordStates')?.rows ?? []
  assert.equal(rows.length, 1)
  const row = rows[0] as { schedulerState: { nativeResearchCard: unknown } }
  assert.ok(row.schedulerState.nativeResearchCard)
  assert.deepEqual(row.schedulerState.nativeResearchCard,
    replayG6Card(context, G6_PROFILES[2], events).snapshot)
})

test('G6-2b: additive FSRS data changes V4 logical fingerprint; row ordering remains canonical', async () => {
  const withCard = createWorkspaceV4(v4Payload(true), metadata)
  const withoutCard = createWorkspaceV4(v4Payload(false), metadata)
  const digestA = await workspaceFingerprintV4(withCard)
  const digestB = await workspaceFingerprintV4(withoutCard)
  assert.notEqual(digestA, digestB, 'V4 must not silently omit additive native FSRS state')
  assert.equal(stableWorkspaceJson(withCard), stableWorkspaceJson(parseWorkspaceV4(JSON.stringify(withCard))))
})
