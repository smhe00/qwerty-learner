---
protocol_version: "1.1"
task_id: "TASK-20261006-003-production-aligned-learn-sim"
status: "PASS"
executor: "chat"
target_branch: "product/main"
release_to_master: false
accepted_head: "39b225a4c6e48e07b4cab745cb0884dad8a6164b"
---

# P1 Production-Aligned Learn Simulator — Execution Report

## Result

PASS. P1 closes the major refinement gap between VirtualLearnApp and current production Learn semantics. No P1 development commit was released to master.

## Branch state at acceptance

- product/main: 39b225a4c6e48e07b4cab745cb0884dad8a6164b
- master: 26e8454f519850374aaf9f3fd61c67c9a7222638
- Branch divergence is intentional.

## Main implementation

- ca3f3807: canonical Learn Trace IR moved to src/learn/trace-ir.ts; shared production mixed-session selector extracted.
- 7aa2db40: lifecycle and terminal-immutability trace invariants.
- 2460a1bd / b10164e6: VirtualLearnApp primary preparation moved to unified mixed-session generation.
- 3063049a: per-word mixed ownership plus route/reload/background/foreground lifecycle actions.
- 879b3bf3: old tests aligned with current production mixed semantics.
- 0a33aca2 / af7d3aed: P0 minimized incident to deterministic P1 lifecycle seed bridge and regression.
- 7c6eabc1: explicit occurrence-vs-logical-word identity invariant.
- 39b225a4: standalone TLA gate moved from rolling v1.8.0 prerelease asset to immutable stable v1.7.4 pin.

## Production semantic alignment

VirtualLearnApp now models the same high-level session selection as production:

Review due candidates + pending/fresh Acquisition -> bounded mixed selection -> review/acquisition/mixed sessionKind -> per-word itemKinds and acquisitionStates.

Important refinement finding: old simulator tests assumed due > 0 implies a pure Review session. Current production behavior is Review priority plus bounded Acquisition reserve, so a mixed session is expected when both categories exist. P1 corrected the model and tests rather than preserving the stale assumption.

## Lifecycle model

First-class deterministic actions now include route-enter, route-leave, reload, background, and foreground. Explorer failures include the exact seed, anomaly codes, and action sequence.

Terminal invariants now detect finished-session resurrection and Learn evidence after terminal completion. Mixed ownership is checked per logical word.

## P0 to P1 bridge

diagnosticToLearnLifecycleSeed converts structural P0 anomalies into deterministic simulation lifecycle actions. A permanent regression now performs: synthetic incident -> P0 replay -> ddmin -> same-schema minimized incident -> P1 lifecycle seed -> clean model survives -> route-resurrection mutation is detected.

## Occurrence identity

Repeated queue occurrences are modeled separately from logical-word state. Review reinforcement can create multiple occurrences of the same spelling, but the model requires exactly one logical item state. The clean regression passes and the duplicated-logical-state mutant is killed.

## Mutation score

- detected: 11 / 11
- sensitivity: 1.0
- false positives: 0 / 8 clean controls

Fault classes include singleton acquisition, dropped projection, stale checkpoint, due bypass, terminal handoff stall, stale audio owner, premature audio advance, terminal route resurrection, post-finish evidence, wrong mixed ownership, and duplicated logical state for repeated occurrence.

## Stateful explorer

- profiles: fresh, warm, due
- seeds: 60
- steps per seed: 220
- approximate scheduled actions: 13,200
- clean failures: 0
- dropped-projection mutation campaign: 12 / 12 detected
- due-first bypass mutation campaign: 8 / 8 detected

## Formal / TLA verification

The first standalone TLA run failed before model checking because the workflow treated the rolling v1.8.0 prerelease asset as immutable. Upstream replaced that asset on 2026-10-06, so the old SHA pin failed. P1 changed the gate to immutable stable v1.7.4 with SHA-256 936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88 and updated the Trace IR trigger path.

TLA Gate 37411758646: SUCCESS. Production quota, deferred liveness, mixed due-priority, checkpoint monotonicity, progress, projection consistency, F6/F7/F8 models all passed. All intended mutation counterexamples were produced and replayed through the shared Trace Oracle.

## Full Review Gate

Review Gate 37410995293: SUCCESS. Lint, domain, acquisition regression, formal bridge, diagnostic CLI smoke, control stability, async ownership, longitudinal simulation, audio formal, FSRS contracts, Typing browser, build, navigation smoke, and Learn/Review browser gate all passed.

## Acceptance criteria

- [x] shared Trace IR moved out of tests
- [x] production-aligned review/acquisition/mixed primary simulation path
- [x] per-word mixed ownership
- [x] reload/restore lifecycle modeling
- [x] terminal restoration and post-finish evidence invariants
- [x] checkpoint monotonicity
- [x] Review volume is distinct from Acquisition cohort size
- [x] P0 minimized trace becomes deterministic P1 seed
- [x] reproducible explorer action sequence
- [x] lifecycle mutation coverage
- [x] occurrence identity invariant
- [x] Review and standalone TLA gates green
- [x] no real user incident committed
- [x] no master release

## Remaining gaps

1. React effect scheduling is abstracted rather than running a real React event loop.
2. IndexedDB/audio timing is abstracted; browser latency interleavings belong in P3.
3. viewport resize is covered by Playwright but not yet a separate virtual action from reload/route.
4. P0-to-P1 mapping is structural, not a lossless browser-event reconstruction.
5. Mutation coverage is class-based; P2 should enforce a CI threshold and broaden critical fault classes.

## Recommended next phase

P2: Mutation 2.0 + systematic coverage review, then P3 browser stateful fuzzing.
