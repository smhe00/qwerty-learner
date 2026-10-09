import assert from 'node:assert/strict'
import test from 'node:test'
import type { Word } from '../../src/typings'
import { VirtualLearnApp } from './system-driver'
import { detectLearnSystemAnomalies } from './system-oracle'

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
