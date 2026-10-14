import assert from 'node:assert/strict'
import test from 'node:test'
import { preflightAttemptIdentity } from '../../src/sync/v4-merge-preflight'
import type { IWordRecord } from '../../src/utils/db/record'

const a = '3d14a22c-142d-4d2a-8c21-f165219a67a0'
const b = '98417ebc-a94e-4fe8-a27c-298f09ed7186'
const c = 'b028ee77-68b2-4681-9fdd-17a18d984e10'
const mk = (attemptId: string | undefined, id: number, dict: string,
  word: string, timeStamp: number): IWordRecord => ({
  id, ...(attemptId === undefined ? {} : { attemptId }),
  dict, word, chapter: -1, timeStamp,
  sourceMode: 'learn', learnItemKind: 'review',
  timing: [100, 110, 120], mistakes: {}, wrongCount: 0,
  reviewRatingDecision: { eligible: true, rating: 'good', confidence: 1,
    reasonCodes: ['cold-probe'] },
})

test('distinct dictionaries reconcile using immutable identity even with local PK collision', () => {
  const result = preflightAttemptIdentity({
    local: [mk(a, 1, 'cet4', 'ability', 2000)],
    remote: [mk(b, 1, 'shanghai', 'english', 2100)],
  })
  assert.deepEqual([result.safeEventIdentity, result.localOnly, result.remoteOnly],
    [true, 1, 1])
  assert.equal(result.identityConflicts, 0)
  assert.equal(result.legacyUnverified, 0)
})

test('independent same-word learning attempts remain separate even within same second', () => {
  const result = preflightAttemptIdentity({
    local: [mk(a, 1, 'cet4', 'ability', 2000)],
    remote: [mk(b, 1, 'cet4', 'ability', 2000)],
  })
  assert.equal(result.safeEventIdentity, true)
  assert.equal(result.perDictionary.cet4.localOnly, 1)
  assert.equal(result.perDictionary.cet4.remoteOnly, 1)
  assert.equal(result.shared, 0)
})

test('retransmitted UUID deduplicates even when local numeric IDs and derived shadow differ', () => {
  const local = mk(a, 1, 'cet4', 'ability', 2000)
  const remote = { ...local, id: 7, fsrsShadow: {
    marker: 'derived-only', // acceptance classifier intentionally ignores it
  } } as unknown as IWordRecord
  const result = preflightAttemptIdentity({ local: [local], remote: [remote] })
  assert.equal(result.safeEventIdentity, true)
  assert.equal(result.shared, 1)
})

test('same attempt UUID with different learning evidence blocks reconciliation', () => {
  const local = mk(a, 1, 'cet4', 'ability', 2000)
  const remote = { ...mk(a, 2, 'cet4', 'ability', 2000), wrongCount: 3 }
  const result = preflightAttemptIdentity({ local: [local], remote: [remote] })
  assert.equal(result.safeEventIdentity, false)
  assert.equal(result.identityConflicts, 1)
})

test('old records cannot be blindly matched using word, time or local ID', () => {
  const local = mk(undefined, 1, 'cet4', 'ability', 2000)
  const cloud = { ...local }
  const unsafe = preflightAttemptIdentity({ local: [local], remote: [cloud] })
  assert.equal(unsafe.safeEventIdentity, false)
  assert.equal(unsafe.legacyUnverified, 1)
  const anchored = preflightAttemptIdentity({
    local: [local], remote: [cloud], commonAncestor: [{ ...local }],
  })
  assert.equal(anchored.safeEventIdentity, true)
  assert.equal(anchored.anchoredLegacy, 1)
})

test('legacy branches modifying or losing ancestor attempts stay unresolved', () => {
  const old = mk(undefined, 1, 'cet4', 'ability', 2000)
  const changed = { ...old, wrongCount: 3 }
  const mismatch = preflightAttemptIdentity({
    local: [old], remote: [changed], commonAncestor: [old],
  })
  assert.equal(mismatch.safeEventIdentity, false)
  const missing = preflightAttemptIdentity({
    local: [old], remote: [], commonAncestor: [old],
  })
  assert.equal(missing.safeEventIdentity, false)
})

test('duplicate or malformed UUIDs fail closed within one branch', () => {
  const local = [
    mk(a, 1, 'cet4', 'ability', 2000),
    mk(a, 2, 'cet4', 'ability', 2001),
    mk('bad-identity', 3, 'cet4', 'ability', 2002),
  ]
  const outcome = preflightAttemptIdentity({ local, remote: [] })
  assert.equal(outcome.safeEventIdentity, false)
  assert.equal(outcome.identityConflicts, 2)
})

test('local-cloud order swap preserves counts for new events', () => {
  const local = [mk(a, 1, 'cet4', 'ability', 2000), mk(c, 3, 'cet4', 'when', 4000)]
  const remote = [mk(a, 6, 'cet4', 'ability', 2000), mk(b, 5, 'shanghai', 'english', 2500)]
  const first = preflightAttemptIdentity({ local, remote })
  const reversed = preflightAttemptIdentity({ local: remote, remote: local })
  assert.equal(first.safeEventIdentity, true)
  assert.equal(reversed.safeEventIdentity, true)
  assert.equal(first.shared, reversed.shared)
  assert.equal(first.localOnly, reversed.remoteOnly)
  assert.equal(first.remoteOnly, reversed.localOnly)
})
