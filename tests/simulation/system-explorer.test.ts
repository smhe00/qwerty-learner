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

type ExplorerProfile = 'fresh' | 'warm' | 'due'

async function explore(
  seed: number,
  mutation?: ConstructorParameters<typeof VirtualLearnApp>[0]['mutation'],
  profile: ExplorerProfile = 'fresh',
) {
  const random = rng(seed)
  const app = new VirtualLearnApp({
    words: Array.from(
      { length: 18 },
      (_, index) => word(`e${index}`),
    ),
    mutation,
  })

  if (profile === 'warm' || profile === 'due') {
    app.seedAdmittedWords(6)
  }
  if (profile === 'due') {
    app.makeSeededWordsDue(3)
  }

  await app.enter()

  for (let step = 0; step < 220; step += 1) {
    const choice = random()

    if (choice < 0.58) {
      const quality = random()
      const outcome =
        quality < 0.68
          ? ('good' as const)
          : quality < 0.88
            ? ('hard' as const)
            : ('again' as const)
      const progressed =
        app.completeCurrentAttempt(outcome)
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

  const profiles: ExplorerProfile[] = [
    'fresh',
    'warm',
    'due',
  ]
  for (const profile of profiles) {
    for (let seed = 1; seed <= 20; seed += 1) {
      const effectiveSeed =
        seed + profiles.indexOf(profile) * 1000
      const result = await explore(
        effectiveSeed,
        undefined,
        profile,
      )
      if (result.anomalies.length > 0) {
        failures.push({
          seed: effectiveSeed,
          codes: result.anomalies.map((item) => item.code),
        })
      }
    }
  }

  console.log(
    'SIM_SYSTEM_EXPLORER',
    JSON.stringify({
      profiles,
      seeds: 60,
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


test('blind random explorer detects projection faults injected at unknown interaction positions', async () => {
  const results: Array<{
    seed: number
    mutationAt: number
    detected: boolean
  }> = []

  for (let seed = 101; seed <= 112; seed += 1) {
    const random = rng(seed * 17)
    const mutationAt = 1 + Math.floor(random() * 12)
    const result = await explore(seed, {
      dropProjectionAtInteraction: mutationAt,
    })
    results.push({
      seed,
      mutationAt,
      detected: result.anomalies.some(
        (item) =>
          item.code === 'controller-driver-divergence',
      ),
    })
  }

  const detected = results.filter(
    (item) => item.detected,
  ).length

  console.log(
    'SIM_EXPLORER_MUTATION_CAMPAIGN',
    JSON.stringify({
      kind: 'drop-projection',
      detected,
      total: results.length,
      results,
    }),
  )

  assert.equal(detected, results.length)
})

test('blind random explorer discovers due-first bypass across randomly acting due-bearing users', async () => {
  const results: Array<{
    seed: number
    detected: boolean
  }> = []

  for (let seed = 201; seed <= 208; seed += 1) {
    const result = await explore(
      seed,
      {
        bypassDueFirst: true,
      },
      'due',
    )
    results.push({
      seed,
      detected: result.anomalies.some(
        (item) => item.code === 'due-work-bypassed',
      ),
    })
  }

  const detected = results.filter(
    (item) => item.detected,
  ).length

  console.log(
    'SIM_EXPLORER_MUTATION_CAMPAIGN',
    JSON.stringify({
      kind: 'due-first-bypass',
      detected,
      total: results.length,
      results,
    }),
  )

  // The fault precondition is present, but the action sequence is random.
  // Every seeded run must eventually expose the priority violation.
  assert.equal(detected, results.length)
})
