# Coverage Review 3.0 — Qwerty Plus Learn Verification

## Scope

Coverage Review 3.0 evaluates the current verification stack as a **fault-detection system**, not merely a collection of green tests.

Catalog source of truth:

```text
tests/simulation/fault-catalog.ts
P2_FAULT_CATALOG_VERSION = 1
```

## Executive result

```text
catalog total                 42
covered                       38
partial                        4
uncovered                      0
out-of-scope                   0

executable critical mutations 29
killed                         29
critical kill rate            100%

clean controls                11
false positives                0
```

This **does not mean total product correctness is 100% proven**. The 100% number applies only to the currently defined executable critical mutation denominator.

## Detector-layer reach

A single fault may have more than one detector.

```text
simulation    34 catalog entries
formal        21
browser       15
P0 replay      9
domain         4
```

## Fault families

```text
candidate-budget       11
terminal-persistence    9
persistence-order       8
async-browser           8
mixed-identity          6
```

## P2 findings that changed verification itself

### 1. Fresh-budget oracle was still partially tied to an older model

The current product uses mixed sessions: Review keeps priority, but due Review does not imply a hard zero Acquisition allowance.

P2 found that the shared `fresh-budget` oracle still reconstructed expectations from a simplified quota-only view. It could also assume all ready pending work must be selected even when mixed-session capacity bounds selection.

Fix:

- trace now carries `expectedAllowedNow` from the production daily planner;
- trace carries `expectedPendingSelected` from the production mixed-session baseline;
- the oracle compares actual behavior against those explicit baselines instead of recreating retired rules.

### 2. FreshBudget TLA model still encoded `due => allowedNow = 0`

This was a real formal-model refinement gap.

Production had already moved to:

```text
due Review priority
+ bounded Acquisition reserve
=> mixed session
```

but `formal/learn/FreshBudget.tla` still treated due work as a hard Acquisition gate.

P2 corrected the formal model:

- FreshBudget now models quota/accounting independently of due-priority composition;
- `DuePriority.tla` remains responsible for Review-priority correctness;
- the TLA trace bridge now emits explicit expected allowance/pending-selection evidence.

Standalone TLA Gate is green after this change.

## Stateful exploration

Current clean explorer:

```text
profiles: fresh / warm / due
seeds: 60
steps per seed: 220
scheduled actions: ~13,200
clean failures: 0
```

Mutation discovery campaigns:

```text
drop-projection: 12 / 12 detected
due-first bypass: 8 / 8 detected
```

## Partial coverage — explicit remaining gaps

### `stale-async-preparation-wins-navigation`

**Status: partial**

Selected async ownership races are covered, but arbitrary route schedules are not yet browser-fuzzed. P3 should generate navigation/preparation interleavings.

### `route-cache-idb-divergence-after-crash`

**Status: partial**

P0 can diagnose a captured cache/IndexedDB contradiction, and browser tests cover normal reload behavior. The virtual model does not yet emulate a process crash precisely between synchronous route-cache commit and asynchronous IndexedDB durability.

### `refresh-during-checkpoint-commit-window`

**Status: partial**

Stale checkpoint ordering is modeled and formally checked. A real browser refresh at arbitrary persistence timing belongs to P3 stateful browser fuzzing.

### `viewport-resize-without-document-reload`

**Status: partial**

A concrete Playwright regression protects the historical desktop-resize bug. Simulation currently models reload/route lifecycle but not viewport resize as an independent virtual action.

## Catalog matrix

| Fault ID | Family | Severity | Status | Executable mutation | Detector layers |
| --- | --- | --- | --- | --- | --- |
| `repeated-singleton-selection` | candidate-budget | high | covered | yes | simulation, formal |
| `dropped-controller-projection` | terminal-persistence | high | covered | yes | simulation, formal |
| `success-without-semantic-progress` | terminal-persistence | high | covered | yes | simulation, formal |
| `stale-checkpoint-rollback` | persistence-order | high | covered | yes | simulation, formal |
| `finished-checkpoint-resurrection` | terminal-persistence | high | covered | yes | simulation, p0-replay |
| `due-review-bypassed` | candidate-budget | high | covered | yes | simulation, formal |
| `final-word-durable-without-ui-finish` | terminal-persistence | high | covered | yes | simulation, browser, p0-replay |
| `stale-audio-owner` | async-browser | high | covered | yes | simulation, formal, browser |
| `success-advance-before-audio-settles` | async-browser | high | covered | yes | simulation, formal, browser |
| `finished-session-route-resurrection` | terminal-persistence | high | covered | yes | simulation, browser, p0-replay |
| `post-finish-evidence` | terminal-persistence | high | covered | yes | simulation, browser, p0-replay |
| `wrong-mixed-item-ownership` | mixed-identity | high | covered | yes | simulation, domain |
| `duplicate-logical-state-for-repeated-occurrence` | mixed-identity | high | covered | yes | simulation |
| `persistence-commit-before-request` | persistence-order | high | covered | yes | simulation |
| `persistence-out-of-order-commit` | persistence-order | high | covered | yes | simulation |
| `stranded-deferred-acquisition` | candidate-budget | high | covered | yes | simulation, formal |
| `pending-as-fresh` | candidate-budget | high | covered | yes | simulation, formal |
| `admitted-as-fresh` | candidate-budget | high | covered | yes | simulation, formal |
| `excluded-word-selected` | candidate-budget | high | covered | yes | simulation, formal |
| `duplicate-canonical-selection` | mixed-identity | high | covered | yes | simulation, formal |
| `fresh-selection-over-budget` | candidate-budget | high | covered | yes | simulation, formal |
| `pending-consumes-fresh-budget` | candidate-budget | high | covered | yes | simulation, formal |
| `quota-ignores-unseen-cap` | candidate-budget | high | covered | yes | simulation, formal |
| `acquired-vs-introduced-quota-accounting` | candidate-budget | high | covered | yes | simulation, formal |
| `finished-shadows-unfinished` | terminal-persistence | high | covered | yes | simulation, formal |
| `oldest-unfinished-restored` | persistence-order | high | covered | yes | simulation, formal |
| `wrong-dictionary-restored` | persistence-order | high | covered | yes | simulation, formal |
| `waiting-despite-unfinished` | terminal-persistence | high | covered | yes | simulation, formal |
| `pure-review-over-20-wrongly-rotated` | mixed-identity | high | covered | no | domain, p0-replay |
| `mixed-total-counted-as-acquisition-cohort` | mixed-identity | high | covered | no | domain, p0-replay, simulation |
| `legacy-mixed-missing-itemKinds` | mixed-identity | high | covered | no | domain, simulation |
| `workload-soft-budget-ignored` | candidate-budget | high | covered | yes | simulation |
| `howl-not-ready-loses-success-audio` | async-browser | high | covered | no | browser |
| `audio-cleanup-stops-new-owner` | async-browser | high | covered | no | browser, formal |
| `desktop-resize-forces-root-reload` | async-browser | high | covered | no | browser, simulation |
| `background-focus-resets-statistics` | async-browser | high | covered | no | browser |
| `incident-export-replay-contract-break` | persistence-order | high | covered | no | browser, p0-replay |
| `terminal-ui-divergence-field-incident` | terminal-persistence | high | covered | no | p0-replay, browser, simulation |
| `stale-async-preparation-wins-navigation` | async-browser | high | partial | no | browser |
| `route-cache-idb-divergence-after-crash` | persistence-order | high | partial | no | p0-replay, browser |
| `refresh-during-checkpoint-commit-window` | persistence-order | high | partial | no | simulation, browser |
| `viewport-resize-without-document-reload` | async-browser | medium | partial | no | browser |

## CI policy

The threshold is executable code, not prose:

```ts
P2_MUTATION_POLICY = {
  minExecutableCriticalFaults: 18,
  requiredCriticalKillRate: 1,
  maxCleanFalsePositives: 0,
}
```

Current measured result:

```text
29 executable critical faults
29 detected
kill rate = 1.0
clean false positives = 0 / 11
```

Any future executable critical fault added to the catalog without a matching killed mutation will fail Review Gate.

## Relationship between layers

The intended stack is now:

```text
Domain tests
  ↓ local semantic contracts

Simulation + Mutation
  ↓ long stateful behavioral sequences

Formal / TLA+
  ↓ bounded invariants and counterexamples

Browser lifecycle
  ↓ real React / audio / route / viewport behavior

P0 field replay
  ↓ real incident evidence + minimization
```

No one layer is treated as a substitute for the others.

## Next phase

P3 should focus on the four partial classes above, especially browser stateful fuzzing:

- route/navigation races;
- reload/refresh during persistence windows;
- browser lifecycle + audio timing;
- viewport/background/focus actions;
- deterministic seed/action replay.

