import assert from 'node:assert/strict'
import test from 'node:test'
import type { Word } from '../../src/typings'
import { VirtualLearnApp } from './system-driver'
import { detectLearnSystemAnomalies } from './system-oracle'

function word(name: string): Word {
  return {
    name,
    trans: [name],
    usphone: '',
    ukphone: '',
  }
}

function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x1_0000_0000
  }
}

async function explore(seed: number) {
  const random = rng(seed)
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 18 },
      (_, index) => word(`e${index}`),
    ),
  })

  await app.enter()

  for (let step = 0; step < 220; step += 1) {
    const choice = random()

    if (choice < 0.58) {
      const progressed = app.completeCurrentClean()
      if (!progressed) await app.enter()
      continue
    }

    if (choice < 0.7) {
      await app.refresh()
      continue
    }

    if (choice < 0.8) {
      app.exit()
      await app.enter()
      continue
    }

    if (choice < 0.94) {
      const seconds = [60, 300, 600, 3600][
        Math.floor(random() * 4)
      ]
      app.advanceSeconds(seconds)
      if (random() < 0.5) {
        app.exit()
        await app.enter()
      }
      continue
    }

    app.advanceDays(1)
    app.exit()
    await app.enter()
  }

  return {
    app,
    anomalies: detectLearnSystemAnomalies(app.events),
  }
}

test('deterministic random user-action exploration stays anomaly-free across clean production controllers', async () => {
  const failures: Array<{
    seed: number
    codes: string[]
  }> = []

  for (let seed = 1; seed <= 16; seed += 1) {
    const result = await explore(seed)
    if (result.anomalies.length > 0) {
      failures.push({
        seed,
        codes: result.anomalies.map((item) => item.code),
      })
    }
  }

  console.log(
    'SIM_SYSTEM_EXPLORER',
    JSON.stringify({
      seeds: 16,
      stepsPerSeed: 220,
      failures,
    }),
  )

  assert.deepEqual(failures, [])
})

test('random action exploration remains reproducible for the same seed', async () => {
  const left = await explore(77)
  const right = await explore(77)

  assert.deepEqual(left.app.events, right.app.events)
  assert.deepEqual(left.anomalies, right.anomalies)
})
