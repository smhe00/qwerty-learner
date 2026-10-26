/**
 * Bounded timed-path audit, not a proof of the entire program.
 * Replay a code-linked post-M4 path with finitely enumerated successful network
 * latencies. CPU, IDB, navigation and optional checkout costs are ZERO: this is
 * a lower bound, never a measured production duration or failure probability.
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const evidence = resolve(root, 'interactive/reports/evidence/LOGIN-BOOT-FORMAL-AUDIT-20261026')
const actual = JSON.parse(readFileSync(resolve(evidence, 'actual-kernel-proof.json'), 'utf8'))
assert.equal(actual.sameLocalMerge.candidateEqualsLocal, true)
assert.equal(actual.sameLocalMerge.status, 'pull-reload-required')
assert.equal(actual.sameLocalMerge.stagedSnapshotEqualsLive, true)
assert.equal(actual.sameLocalMerge.afterRecoveryStatus, 'noop')
assert.deepEqual(actual.sameLocalMerge.ioBeforeRecovery, ['meta', 'download', 'meta', 'CAS-upload'])
assert(actual.faults.every((f) => f.safetyChecksPassed))

const source = (name) => readFileSync(resolve(root, 'src', name), 'utf8')
const bindings = [
  ['sync/v2-manual-executor.ts', "return { status: 'pull-reload-required', revision, automaticMerge: true }"],
  ['sync/workspace-bootstrap.ts', 'S2 Pull staged; reload required before mounting app'],
  ['sync/workspace-bootstrap.ts', 'S2 Pull recovery completed; reload required before mounting app'],
  ['index.tsx', 'await prepareGuardedWorkspaceBoot'],
  ['sync/api.ts', "request<BinaryManifest>('/api/sync/v2/binary/manifest'"],
  ['sync/api.ts', "fetch(apiUrl('/api/sync/v2/binary/part?'"],
  ['sync/multi-device-outbox-transport.ts', 'readChainedEventBatch'],
  ['sync/m4-witnessed-prefix-browser.ts', "timePerfStage('sync', 'm4-observe'"],
]
for (const [file, text] of bindings) {
  // index wraps the call in timePerfStage, so bind that call separately.
  const needle = file === 'index.tsx' ? 'prepareGuardedWorkspaceBoot(onStage' : text
  assert(source(file).includes(needle), 'source binding drifted: ' + file)
}

// Feasible branch: M4 adopted; no baseline; smaller cloud; one compressed part;
// merged local already exact; new imported attempts produce one M3 batch.
// Optional M2 checkout and final witnessed proof are omitted, making this cheaper.
const steps = [
  ['s2-meta', 90],
  ['s2-download-manifest', 90],
  ['s2-download-part', 90],
  ['s2-meta-recheck', 90],
  ['s2-CAS-ack-verified', 90],
  ['s2-meta-after-two-extra-reloads', 90],
  ['m3-publish', 30],
  ['m3-exact-readback', 30],
  ['m4-observe', 30],
]
const latencyDomainSeconds = [1, 10, 22, 29]
let schedules = 0,
  exceeds180BeforeWitness = 0
let maxLowerBoundSeconds = 0
function visit(index, elapsed) {
  if (index === steps.length) {
    schedules++
    maxLowerBoundSeconds = Math.max(maxLowerBoundSeconds, elapsed)
    if (elapsed > 180) exceeds180BeforeWitness++
    return
  }
  for (const delay of latencyDomainSeconds) {
    assert(delay < steps[index][1], 'model delay must not trigger request timeout')
    visit(index + 1, elapsed + delay)
  }
}
visit(0, 0)
const trace = steps.map(([stage, timeout], index) => ({
  stage,
  response: 'success',
  requestDeadlineSeconds: timeout,
  startsAtSeconds: index * 22,
  finishesAtSeconds: (index + 1) * 22,
}))
assert.equal(schedules, 4 ** 9)
assert(exceeds180BeforeWitness > 0)
assert.equal(trace.at(-1).finishesAtSeconds, 198)
assert.equal(trace[7].finishesAtSeconds, 176)

const proof = {
  sourceSha: actual.sourceSha,
  method: 'finite timed-path enumeration linked to an actual-kernel counterexample',
  limits: [
    'One feasible post-M4 path, not exhaustive state-space or unbounded liveness proof.',
    'Successful modeled requests; no HTTP503, no packet loss, no retries, no concurrent server writer.',
    'Assumes one-part V4 and one new M3 event batch. M3 publication branch is conditional, not universal.',
    'Omits all CPU/IDB/navigation time, optional checkout and final witness proof.',
    'Schedule counts are combinatorial coverage, NOT observed likelihood.',
    'Does not establish which delay or branch occurred in CI run 40253418650.',
  ],
  safetyFaultCases: actual.faults.length,
  latencyDomainSeconds,
  schedules,
  exceeds180BeforeWitness,
  maxLowerBoundSeconds,
  counterexample: {
    allResponsesSuccessful: true,
    everyRequestBelowOwnDeadline: true,
    checkpointAt180: 'm4-observe pending; application has not reached mount',
    minimumTraceDurationSeconds: 198,
    trace,
  },
  unnecessaryRestore: {
    localEqualsVerifiedCloud: true,
    durablePullStillStaged: true,
    additionalReloadsImpliedByBootstrap: 2,
    note: 'Recovery succeeds in the real kernel test; no infinite reload loop proven.',
  },
}
writeFileSync(resolve(evidence, 'bounded-timing-proof.json'), JSON.stringify(proof, null, 2) + '\n')
console.log(
  JSON.stringify(
    {
      schedules,
      exceeds180BeforeWitness,
      maxLowerBoundSeconds,
      counterexampleSeconds: 198,
      faultCases: actual.faults.length,
    },
    null,
    2,
  ),
)
