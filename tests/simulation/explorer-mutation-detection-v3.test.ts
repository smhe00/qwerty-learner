import assert from 'node:assert/strict'
import test from 'node:test'
import type { Word } from '../../src/typings'
import { VirtualLearnApp, type VirtualLearnMutation } from './system-driver'
import { detectLearnSystemAnomalies } from './system-oracle'

/**
 * Blind behavioral mutation campaign. Mutations are enabled only in the
 * disposable VirtualLearnApp driver; no production code, user data, browser
 * storage or server state is changed.
 *
 * In contrast to mutation-scorecard.test.ts, this does NOT manufacture
 * oracle trace events. The seeded action explorer must produce the evidence
 * by exercising the actual controller and storage simulation.
 */
type Profile = 'fresh' | 'warm' | 'due'
const STEPS = 220
const SEEDS = [101, 102, 103, 104, 105, 106]
const wordList: Word[] = Array.from({ length: 24 }, (_, i) => ({
  name: 'blind' + i, trans: [], usphone: '', ukphone: '',
}))

type FaultCase = {
  id: string
  profile: Profile
  mutation: VirtualLearnMutation
  expected: string[]
}

const cases: FaultCase[] = [
  { id: 'drop-progress-projection', profile: 'fresh',
    mutation: { dropProjectionAtInteraction: 3 },
    expected: ['controller-driver-divergence'] },
  { id: 'silent-success-without-progress', profile: 'fresh',
    mutation: { silentNoopAtInteraction: 3 },
    expected: ['success-without-progress', 'controller-driver-divergence'] },
  { id: 'due-review-skipped', profile: 'due',
    mutation: { bypassDueFirst: true },
    expected: ['due-work-bypassed'] },
  { id: 'new-word-budget-overflow', profile: 'fresh',
    mutation: { freshOverBudget: true },
    expected: ['fresh-budget-violation'] },
  { id: 'duplicated-canonical-word', profile: 'fresh',
    mutation: { duplicateCanonical: true },
    expected: ['candidate-lifecycle-violation', 'occurrence-identity-violation'] },
  { id: 'quota-counts-acquired-not-introduced', profile: 'fresh',
    mutation: { quotaAccounting: 'acquired' },
    expected: ['fresh-budget-violation'] },
  { id: 'admitted-word-reentered-as-acquisition', profile: 'warm',
    mutation: { admittedInAcquisition: true },
    expected: ['candidate-lifecycle-violation'] },
  { id: 'wrong-review-acquisition-ownership', profile: 'due',
    mutation: { wrongMixedOwnership: true },
    expected: ['mixed-item-ownership-violation'] },
  { id: 'finished-block-resurrects', profile: 'fresh',
    mutation: { routeResurrectsFinished: true },
    expected: ['terminal-session-resurrection', 'checkpoint-regression'] },
  { id: 'stale-checkpoint-on-resume', profile: 'fresh',
    mutation: { staleRestoreOnce: true },
    expected: ['checkpoint-regression'] },
  { id: 'deferred-word-stranded', profile: 'fresh',
    mutation: { strandReadyDeferred: true },
    expected: ['stranded-pending-acquisition'] },
  { id: 'deferred-misclassified-as-fresh', profile: 'fresh',
    mutation: { pendingAsFresh: true },
    expected: ['candidate-lifecycle-violation'] },
  { id: 'persist-evidence-after-block-finish', profile: 'fresh',
    mutation: { postFinishEvidence: true },
    expected: ['post-finish-evidence'] },
  { id: 'wait-despite-recoverable-session', profile: 'fresh',
    mutation: { waitingDespiteUnfinished: true },
    expected: ['session-arbitration-violation'] },
]

/**
 * General-purpose risk profiles. These deliberately establish hard-to-hit
 * preconditions; the action policy and anomaly oracle never inspect the
 * injected mutation, and the same scenarios run on clean controls.
 */
type CoverageScenario =
  | 'new-quota-headroom'
  | 'introduced-not-acquired'
  | 'stale-after-progress'
  | 'deferred-due'

const focusedGaps = [
  { id: 'new-word-budget-overflow', profile: 'fresh', scenario: 'new-quota-headroom' },
  { id: 'quota-counts-acquired-not-introduced', profile: 'fresh', scenario: 'introduced-not-acquired' },
  { id: 'stale-checkpoint-on-resume', profile: 'fresh', scenario: 'stale-after-progress' },
  { id: 'deferred-word-stranded', profile: 'fresh', scenario: 'deferred-due' },
] as const satisfies Array<{ id: string; profile: Profile; scenario: CoverageScenario }>

function randomNumber(seed: number) {
  let current = seed >>> 0
  return () => ((current = (1664525 * current + 1013904223) >>> 0) / 4294967296)
}

async function runSeed(
  seed: number, profile: Profile, mutation?: VirtualLearnMutation,
  scenario?: CoverageScenario,
) {
  const dailyNewWordTarget = scenario === 'introduced-not-acquired' ? 1
    : scenario === 'new-quota-headroom' ? 3 : 32
  const app = new VirtualLearnApp({ words: wordList, mutation, dailyNewWordTarget })
  if (profile !== 'fresh') app.seedAdmittedWords(6)
  if (profile === 'due') app.makeSeededWordsDue(3)
  if (scenario === 'introduced-not-acquired') {
    // A real Exposure record but no valid Independent admission yet.
    app.seedDeferredAcquisition({ wordIndex: 0, ready: false })
  }
  if (scenario === 'deferred-due') {
    app.seedDeferredAcquisition({ wordIndex: 0, ready: true })
  }
  const rand = randomNumber(seed)
  const actions: string[] = ['enter']
  let runtimeError: string | null = null
  try {
    await app.enter()
    if (scenario === 'stale-after-progress') {
      // First force an actual durable write in the same session. A checkpoint
      // captured before any save has no historical identity and cannot be
      // distinguished from legitimate queue rewriting by the event oracle.
      // Then save an older *persisted* version and progress beyond it.
      if (!app.completeCurrentClean()) {
        throw new Error('coverage fixture could not persist initial checkpoint')
      }
      app.seedStaleCheckpointFromActive()
      const snapshot = app.snapshot()
      const initial = snapshot.sessions.find(x => x.id === snapshot.activeSessionId)
      const initialIndex = initial?.index ?? 0
      let progress = false
      for (let attempt = 0; attempt < 70; attempt++) {
        const advanced = app.completeCurrentClean()
        if (!advanced) break
        const state = app.snapshot()
        const active = state.sessions.find(x => x.id === state.activeSessionId)
        if (active && active.index > initialIndex) {
          progress = true
          break
        }
      }
      if (!progress) throw new Error('coverage fixture could not establish checkpoint advancement')
      app.exit()
      await app.enter()
      actions.push('checkpoint-progress/exit/reenter')
    }
    if (scenario === 'deferred-due') {
      // Two eligible scheduling opportunities while the Deferred target is
      // ready. The domain oracle observes actual pending health after each.
      app.exit()
      await app.enter()
      actions.push('deferred-ready/reenter')
    }
    for (let step = 0; step < STEPS; step++) {
    const choice = rand()
    if (choice < 0.58) {
      const q = rand()
      const quality = q < 0.68 ? 'good' : q < 0.88 ? 'hard' : 'again'
      if (!app.completeCurrentAttempt(quality)) {
        await app.enter()
        actions.push('attempt-miss/enter')
      } else {
        actions.push('attempt:' + quality)
      }
    } else if (choice < 0.68) {
      await app.refresh()
      actions.push('reload')
    } else if (choice < 0.76) {
      app.exit()
      await app.enter()
      actions.push('route-reenter')
    } else if (choice < 0.82) {
      app.background()
      app.foreground()
      actions.push('background/foreground')
    } else if (choice < 0.94) {
      const seconds = [60, 300, 600, 3600][Math.floor(rand() * 4)]
      app.advanceSeconds(seconds)
      actions.push('time+' + seconds)
      if (rand() < 0.5) {
        app.exit()
        await app.enter()
        actions.push('route-reenter')
      }
    } else {
      app.advanceDays(1)
      app.exit()
      await app.enter()
      actions.push('day+1/reenter')
    }
  }
  } catch (error) {
    // A mutant can corrupt an invariant enough to crash before the
    // generic oracle sees a usable trace. Report separately; never count
    // a runtime crash as a successful oracle detection.
    runtimeError = error instanceof Error ? error.message : String(error)
  }
  const anomalies = detectLearnSystemAnomalies(app.events)
  return {
    codes: [...new Set(anomalies.map(a => a.code))].sort(),
    firstEvidenceIndex: anomalies[0]?.eventIndex ?? null,
    eventCount: app.events.length,
    actions: actions.length,
    runtimeError,
  }
}

test('V3 mutation audit reports actual blind mutant kill rate and clean false-positive rate', async () => {
  const baseline = []
  for (const profile of ['fresh', 'warm', 'due'] as const) {
    for (const seed of SEEDS) {
      const result = await runSeed(seed, profile)
      baseline.push({ profile, seed, codes: result.codes, runtimeError: result.runtimeError })
    }
  }
  const falsePositives = baseline.filter(b => b.codes.length > 0 || b.runtimeError)
  assert.deepEqual(falsePositives, [], 'clean controls must remain anomaly-free')

  const mutants = []
  for (const item of cases) {
    const results = []
    for (const seed of SEEDS) {
      const observed = await runSeed(seed, item.profile, item.mutation)
      const killed = observed.codes.some(code => item.expected.includes(code))
      results.push({
        seed, killed,
        foundCodes: observed.codes,
        firstEvidenceIndex: observed.firstEvidenceIndex,
        eventCount: observed.eventCount,
        runtimeCrash: observed.runtimeError,
      })
    }
    mutants.push({
      id: item.id, profile: item.profile, expectedCodes: item.expected,
      killedSeeds: results.filter(r => r.killed).length,
      crashedSeeds: results.filter(r => r.runtimeCrash).length,
      totalSeeds: SEEDS.length,
      results,
    })
  }
  const kill = mutants.reduce((n, m) => n + m.killedSeeds, 0)
  const total = mutants.length * SEEDS.length
  const survivors = mutants.filter(m => m.killedSeeds < m.totalSeeds)
    .map(m => ({ id: m.id, survived: m.totalSeeds - m.killedSeeds }))
  const guided = []
  const guidedBaseline = []
  for (const focus of focusedGaps) {
    const fault = cases.find(item => item.id === focus.id)
    assert.ok(fault, 'unknown mutation in coverage profile: ' + focus.id)
    const trials = []
    for (const seed of SEEDS) {
      // Controls use exactly the same precondition and action policy.
      const clean = await runSeed(seed, focus.profile, undefined, focus.scenario)
      guidedBaseline.push({
        case: focus.id, seed, codes: clean.codes, runtimeError: clean.runtimeError,
      })
      const observed = await runSeed(seed, focus.profile, fault.mutation, focus.scenario)
      const killed = observed.codes.some(code => fault.expected.includes(code))
      trials.push({
        seed, killed, codes: observed.codes,
        firstEvidenceIndex: observed.firstEvidenceIndex,
        runtimeCrash: observed.runtimeError,
      })
    }
    guided.push({
      id: focus.id, scenario: focus.scenario,
      killedSeeds: trials.filter(x => x.killed).length,
      totalSeeds: SEEDS.length, trials,
    })
  }
  const guidedFalsePositives = guidedBaseline.filter(x => x.codes.length || x.runtimeError)
  assert.deepEqual(guidedFalsePositives, [],
    'guided risk profiles must have zero anomalies on unmodified controllers')
  const guidedKill = guided.reduce((n, item) => n + item.killedSeeds, 0)
  const guidedTotal = guided.length * SEEDS.length
  const combinedKilled = mutants.reduce((n, item) => {
    const focus = guided.find(g => g.id === item.id)
    return n + (focus ? new Set([
      ...item.results.filter(r => r.killed).map(r => r.seed),
      ...focus.trials.filter(r => r.killed).map(r => r.seed),
    ]).size : item.killedSeeds)
  }, 0)
  const summary = {
    schema: 'explorer-v3-blind-mutation-audit-v2',
    architecture: 'isolated-virtual-app-real-controller-oracle',
    cleanControls: baseline.length, cleanFalsePositives: falsePositives.length,
    mutantTypes: mutants.length, seedTrials: total, killedTrials: kill,
    killRate: Number((kill / total).toFixed(4)),
    runtimeCrashTrials: mutants.reduce((n, m) => n + m.crashedSeeds, 0),
    survivors,
    guided: {
      cleanControls: guidedBaseline.length, cleanFalsePositives: guidedFalsePositives.length,
      killedTrials: guidedKill, trials: guidedTotal,
      killRate: Number((guidedKill / guidedTotal).toFixed(4)),
      profiles: guided,
    },
    combinedDetection: {
      killedTrials: combinedKilled, totalTrials: total,
      killRate: Number((combinedKilled / total).toFixed(4)),
    },
    mutants,
  }
  console.log('EXPLORER_V3_BLIND_MUTATION_SCORECARD ' + JSON.stringify(summary))
  // This is a diagnostic measurement, not a manufactured 100% PASS score.
  // A survivor is evidence of an Explorer coverage gap, not a CI crash.
  // Enforce *detection* on the fixed known-fault catalog rather than
  // allowing a green audit merely because one simple mutant was killed.
  // Keep the blind-only 61/84 score published as an honest baseline.
  assert.equal(guidedKill, guidedTotal,
    'all risk-guided historical blind spots must be detected without false positives')
  assert.equal(combinedKilled, total,
    'all known injected behavioral faults must be detectable in at least one reproducible profile')
})
