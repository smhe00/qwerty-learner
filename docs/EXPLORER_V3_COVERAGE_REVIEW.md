# Explorer V3 — Coverage Review

**Branch:** `product/main`. This review changes only automated tests and coverage documentation; never the deployed EdgeOne `master` branch.

## Definition of coverage

A navigation click is not a learning-state transition. Report each target as:

- **B — browser verified:** genuine published Pages UI, keyboard activity, IndexedDB durability and transition result.
- **D — domain verified:** deterministic execution of the actual production acquisition, daily-plan, quota or scheduler logic with boundary assertions.
- **M — modeled longitudinally:** seeded six-day runs of `VirtualLearnApp`; for graded outcomes FSRS-6 is separately rebuilt by production `rebuildActiveFsrsStateFromWordRecords`.
- **N — not yet verified:** explicitly **not a pass**. A green overall Pages deploy can coexist with an advisory Explorer failure.

**Gate rules:** `Pages Regression` is blocking. Both `Run seeded exploration` and `V3 multi-day domain simulation` are advisory with explicitly surfaced step outcomes. Do not report all Explorer tests PASS unless both steps are green.

## State-transition matrix

| ID | Transition / invariant | Prior evidence | New evidence | Residual gap |
|---|---|---|---|---|
| CR-01 | Exposure → Guided → Supported → Independent | B: real typing and phase observation | D: transition chain in coverage gate | Not every transition asserted in a single UI journey |
| CR-02 | Independent failure → Supported assisted retry | B: wrong-key and ESC behavior | D: first independent failure | Two failures in one real browser path remain N |
| CR-03 | Second assistance failure → Deferred and blocked for 299 seconds | N | D: exact 299s/300s boundary, admitted to Supported on resume | B: N |
| CR-04 | Spacing Deferred → Independent with intervening-items floor after 300s | N | D: exact 299s/300s boundary | B: N |
| CR-05 | Daily new-word quota exhaustion and no 4th credit | N | D: 3/3 quota, 4th admission uncredited, new work stops | Browser daily-complete screen + same-day re-entry: N |
| CR-06 | New day replenishes new-word allowance | B: 48-hour unfinished-session recovery | D: dateKey and quota reset | Browser new-day due + quota combination: N |
| CR-07 | Block pause → **same-day** Continue → distinct durable Block | N | B: dedicated same-day continuation + first word in new Block | Multi-block with mid-Block deferred: N |
| CR-08 | Block terminal → settlement, IndexedDB durable, cross-day second Block | B: two full Blocks and 48h jump | Retained B | Three or more consecutive Blocks: N |
| CR-09 | Naturally due review receives first slot, without forced-due seeding | M: graded campaigns (some forced due) | D: mature overnight, priority and reschedule | B: N |
| CR-10 | FSRS-6 Good / Hard / Again and due interval/history rebuild | M: twelve 6-day graded campaigns | Retained M; oracle/replay assertions | Multi-day FSRS browser campaign: N |
| CR-11 | Real keyboard, ESC3, wrong input, reload idempotence, Typing↔Learn | B: three seeded Pages runs | Retained B | Multi-tab while cloud synced is separately owned by S1 |
| CR-12 | Mutation detection / silent no-op / stale projection | M: existing `system-explorer.test.ts` | Retained M, Review Gate | State-space exhaustive TLC remains separate |

## Coverage deliverables and enforcement

1. `tests/simulation/system-explorer-v3-coverage.test.ts`: **four independent production-domain boundary tests**, exercising C1–C6 and CR-09. The CI step explicitly runs this file in addition to the six-day V3 model.
2. `tests/e2e/pages-explorer-multiblock.spec.ts`: new separate real UI case for CR-07. Two-Block cross-day case remains unchanged.
3. CI must output separate browser, model and boundary-coverage outcomes. An exploratory failure must produce a warning, a retained redacted trace, and a clearly labeled failure, even while the Pages deployment itself succeeds.
4. No test accounts, cloud API calls, raw spelling words or real user data are included in the Explorer traces. Clock acceleration is injected only by Playwright while no learning attempt is active.

## Next priorities (not claimed complete)

- **P0:** browser repeated *Independent* failures → actual Assistance Deferred → virtual 5 minutes → legal re-entry.
- **P0:** browser daily-complete result → immediate same-day wait → next-day reset.
- **P1:** browser naturally due FSRS-6 review across virtual days, including IndexedDB stability/difficulty fields after reload.
- **P1:** coverage-guided 3+ Block / 2+ day mixture with mutation-injected regressions.
- **Separate from Pages:** S1 workspace, accounts and multi-machine cloud sync. Do not weaken existing S1 gates to reach Explorer targets.

Update this matrix using actual Actions results; a new scenario must not be marked B solely because its test file exists.
