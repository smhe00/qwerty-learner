import assert from 'node:assert/strict'
import test from 'node:test'
import type { Word } from '../../src/typings'
import { VirtualLearnApp } from './system-driver'
import { detectLearnSystemAnomalies } from './system-oracle'
import { rebuildActiveFsrsStateFromWordRecords } from '../../src/review/fsrs/active'

const DAYS = 6
const SEEDS = 12
const ATTEMPTS_PER_DAY = 160

function rng(seed: number) {
  let state = seed >>> 0
  return () => ((state = (1664525 * state + 1013904223) >>> 0) / 0x100000000)
}
function vocabulary(): Word[] {
  return Array.from({ length: 48 }, (_, index) => ({
    name: 'v3word' + String(index).padStart(3, '0'),
    trans: [],
    usphone: '', ukphone: '',
  }))
}

test('Explorer V3 runs six virtual days, multiple blocks, reloads and due work without real waits', async () => {
  const campaigns: Array<{
    seed: number
    days: number
    finishedBlocks: number
    recordedAttempts: number
    admitted: number
    virtualDaysElapsed: number
    anomalies: string[]
  }> = []

  for (let seed = 1; seed <= SEEDS; seed++) {
    const app = new VirtualLearnApp({
      words: vocabulary(),
      dailyNewWordTarget: 6,
    })
    const random = rng(seed * 941)
    app.seedAdmittedWords(3)
    app.makeSeededWordsDue(2)
    const dayZero = app.now

    for (let day = 0; day < DAYS; day++) {
      if (day > 0) app.advanceDays(1)
      let result = await app.enter()
      if (result.kind === 'waiting') {
        app.exit()
        continue
      }

      for (let step = 0; step < ATTEMPTS_PER_DAY; step++) {
        const current = app.snapshot()
        const active = current.sessions.find((session) =>
          session.id === current.activeSessionId)
        if (!active || active.isFinished) {
          app.exit()
          result = await app.enter()
          if (result.kind === 'waiting') break
          continue
        }

        const roll = random()
        if (roll < 0.04) {
          await app.refresh()
          continue
        }
        if (roll < 0.08) {
          app.exit()
          await app.enter()
          continue
        }
        if (roll < 0.12) {
          app.background()
          app.foreground()
          continue
        }

        // Clean attempts create genuine domain evidence. Scheduler and
        // acquisition transitions remain production code, not test mocks.
        const completed = app.completeCurrentClean()
        if (!completed) {
          throw new Error('V3 model: active block produced an unhandled no-op')
        }
      }
      app.exit()
    }

    const snapshot = app.snapshot()
    const completed = snapshot.sessions.filter((s) => s.isFinished)
    const issues = detectLearnSystemAnomalies(app.events)
    const item = {
      seed, days: DAYS, finishedBlocks: completed.length,
      recordedAttempts: snapshot.wordRecords.length,
      admitted: snapshot.wordStates.filter(s => s.lifecycle === 'active').length,
      virtualDaysElapsed: (snapshot.now - dayZero) / 86400,
      anomalies: issues.map(issue => issue.code),
    }
    campaigns.push(item)
    assert.equal(item.virtualDaysElapsed, DAYS - 1, 'clock must move exactly five days')
    assert.ok(item.finishedBlocks >= 2, 'each seed must finish multiple distinct blocks')
    assert.ok(item.recordedAttempts > 10, 'each seed must create substantive real domain evidence')
    assert.deepEqual(item.anomalies, [], 'production controller invariants must hold')
  }

  console.log('[Explorer V3 simulation]', JSON.stringify({
    seeds: SEEDS, days: DAYS, attemptsPerDay: ATTEMPTS_PER_DAY, campaigns,
  }))
})

/**
 * Review-graded virtual campaign: production controller for arbitration and
 * acquisition, production Review evidence with Good/Hard/Again, followed by
 * the active FSRS-6 rebuild from the exact recorded history.
 *
 * VirtualLearnApp currently uses basic-v2 for its in-memory comparator. Do
 * not confuse that comparator with the separately rebuilt production FSRS-6.
 */
test('Explorer V3 graded review: due-first across six days, Good/Hard/Again and FSRS-6 replay', async () => {
  const outcomes = ['good', 'hard', 'again'] as const
  const summary: Array<{
    seed: number; graded: Record<string, number>; fsrsWords: number;
    finishedBlocks: number; anomalies: string[];
  }> = []

  for (let seed = 1; seed <= 12; seed++) {
    const app = new VirtualLearnApp({
      words: vocabulary(),
      dailyNewWordTarget: 6,
    })
    const random = rng(seed * 871)
    app.seedAdmittedWords(6)
    app.makeSeededWordsDue(6)
    const graded = { good: 0, hard: 0, again: 0 }
    const seenFSRS = new Set<string>()
    let globalReviewCount = 0

    for (let day = 0; day < 6; day++) {
      if (day > 0) {
        app.advanceDays(1)
        // Ensure overdue states receive fresh review opportunities.
        if (day % 2 === 0) app.makeSeededWordsDue(3)
      }
      let entry = await app.enter()
      if (entry.kind === 'waiting') {
        app.exit()
        continue
      }

      for (let step = 0; step < 180; step++) {
        const state = app.snapshot()
        const active = state.sessions.find(s => s.id === state.activeSessionId)
        if (!active || active.isFinished) {
          app.exit()
          entry = await app.enter()
          if (entry.kind === 'waiting') break
          continue
        }
        const current = active.words[active.index]
        if (!current) throw new Error('An active graded-review session lost its cursor word')
        const isReview = active.itemKinds?.[current.name] === 'review' ||
          (active.sessionKind === 'review')
        const roll = random()
        if (roll < 0.05) {
          await app.refresh()
          continue
        }
        if (roll < 0.09) {
          app.exit()
          await app.enter()
          continue
        }
        if (isReview) {
          const grade = outcomes[globalReviewCount % outcomes.length]
          const ok = app.completeCurrentAttempt(grade)
          assert.equal(ok, true, 'a due review should always produce a transition')
          const recorded = app.wordRecords.at(-1)
          if (recorded?.reviewRatingDecision?.eligible === true) {
            graded[grade]++
            globalReviewCount++
            const history = app.wordRecords.filter(x => x.word === current.name)
            const rebuilt = rebuildActiveFsrsStateFromWordRecords(
              'simulation', current.name, history)
            assert.ok(rebuilt, 'eligible review history must rebuild an FSRS state')
            assert.equal(rebuilt.schedulerState.kind, 'fsrs6')
            assert.equal(rebuilt.lastOutcome, grade)
            assert.ok(Number.isFinite(rebuilt.nextReviewAt))
            assert.ok(rebuilt.nextReviewAt >= app.now,
              'FSRS-6 due time must not precede review timestamp')
            assert.equal(rebuilt.reviewCount,
              history.filter(x => x.reviewRatingDecision?.eligible === true).length)
            if (grade === 'again') assert.ok(rebuilt.lapseCount > 0)
            seenFSRS.add(current.name)
          }
        } else {
          const grade = roll < 0.22 ? 'hard' : roll < 0.28 ? 'again' : 'good'
          assert.equal(app.completeCurrentAttempt(grade), true)
        }
      }
      app.exit()
    }
    const failures = detectLearnSystemAnomalies(app.events)
    const item = {
      seed, graded, fsrsWords: seenFSRS.size,
      finishedBlocks: app.snapshot().sessions.filter(x => x.isFinished).length,
      anomalies: failures.map(x => x.code),
    }
    summary.push(item)
    assert.deepEqual(item.anomalies, [])
    assert.ok(item.finishedBlocks >= 2)
    assert.ok(item.fsrsWords >= 3)
    for (const grade of outcomes) {
      assert.ok(item.graded[grade] > 0, 'missing FSRS-rated ' + grade)
    }
  }
  console.log('[Explorer V3 graded FSRS]', JSON.stringify({ seeds: 12, summary }))
})
