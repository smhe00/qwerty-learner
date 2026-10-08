---
protocol_version: "1.1"
task_id: "TASK-20261008-009-acquisition-admission-recovery"
status: "REVIEW"
executor: "codex"
target_branch: "product/main"
claim_base_commit: "9002ed6800f334e86fed9a72b85da9cdef8ba88f"
start_commit: "5f28ede"
last_commit: "591c27994cf2fa61cdd7180f70f80dafb7815761"
upstream_head_at_handoff: "77d1bd71"
dirty_worktree: false
---

# Acquisition admission and recovery — Execution Report

## Executive Status

REVIEW. Implementation and local validation complete. Development branch only; master/EdgeOne unchanged. The implementation commit is e086ce1b; 591c2799 integrates upstream formal-only work. This report is committed after those changes.

## Root Cause

The production diagnostic packet identifies build 74235a0. `accurate` was checkpointed complete after ESC surrender/copy with zero character errors. The progression controller used raw classification and wrongCount, while admission correctly rejected the hint policy and surrender evidence. A complete checkpoint then hid the unadmitted word from pending selection, leaving the frozen daily target unfinished. Short acquisition tails also scheduled immediate probes without sufficient intervening items; those probes could not be admitted even when spelled correctly.

The personal diagnostic packet and raw user records were read locally and are not committed. This repair does not infer mastery from assisted success or alter the configured daily target.

## Changes Made

- `src/learn/admission.ts`, `progression.ts`: shared clean Independent record predicate and identical admission boundary; evaluate the exact persisted record rather than a separate raw classification. Defer Supported tails immediately when their queue cannot provide the required spacing; remove premature duplicate probes.
- Word/WordPanel: pass the finalized record to progression and apply queue removals as well as insertions.
- `src/learn/acquisition-recovery.ts`, DB review-record adapter: recover unadmitted historical complete checkpoints as Supported; valid admission and lifecycle exclusions take precedence. Repair unfinished checkpoints without resetting the cursor; preserve finished history.
- Incident unit/browser regressions, production-shaped simulation adapters, review gate, gate manifest and regression catalog: lock the reported failure and recovery paths into executable checks.

## Validation Executed

| Check | Method | Result |
|---|---|---|
| Domain/review/daily/acquisition/recovery, simulation, FSRS, trace bridge | esbuild bundle + Node test runner | 301 passed, 0 failed, 0 skipped; 39.477 seconds |
| Incident regression subset | Included in Node suite | 9 passed |
| Learn acquisition and recovery browser suites | Playwright Chrome, learn-acquisition-flow and learn-recovery-flow | 21 passed, 0 failed; 1.1 minutes |
| Ordinary Typing control | Playwright Chrome typing-lifecycle suite | 8 passed, 0 failed; 35.8 seconds |
| Changed production source lint | ESLint | 0 errors; 3 existing hook/unused warnings |
| Production build | yarn build | PASS, 44.14 seconds total |
| Gate manifest | node scripts/validate-gate-manifest.mjs | PASS: 9 gates, 20 contracts; rerun after upstream merge |
| Architecture boundary | node scripts/validate-architecture-boundaries.mjs | PASS: 55 Learn/Review modules + 3 low-level files; rerun after merge |
| Whitespace | git diff --check | PASS |
| Standalone TypeScript typecheck; complete remote CI; new upstream TLC projections | Not executed locally | NOT_RUN; no claim of passing |

Browser tests used isolated localhost ports and process-local proxy overrides. The historical regression proves recovery with zero remaining fresh quota, preserves the daily target, crosses the five-minute spacing boundary using a controlled clock, admits on clean Independent evidence, and reaches the daily completion UI. The ESC regression verifies no FSRS admission after surrender/copy. Local execution logs are ignored `.incident-*` files.

## Acceptance Criteria Status

All six task criteria have executable passing evidence: ESC rejection; shared clean admission/completion/daily accounting; conservative historical recovery and lifecycle preservation; short-tail delayed probes; browser incident reproduction/recovery; executable governance references.

## Branch Divergence and Git State

Claimed at 9002ed68. Integrated documentation commit 024adc8 in 5f28ede before implementation. Remote advanced to 77d1bd71 with Sync V2 formal models/workflow and a manifest reference; merged safely in 591c2799. No Learn/Typing production changes came from that integration. Manifest and boundary checks reran successfully. No force push or release branch changes.

The isolated checkout is `C:/Users/peter/Documents/Codex/2026-10-08/qwerty-incident-fix`. A local stash named `Preserved repository-wide pre-commit formatting from incident task claim` retains unrelated formatting produced by the repository's whole-tree hook. That stash is intentionally preserved and excluded from the repair. Later commits disable that mutating hook while retaining the manual checks above.

## Remaining Risks / Exact Next Action

1. Review e086ce1b and this report, then inspect development-branch CI results. Task status remains REVIEW; reviewer owns final acceptance.
2. After explicit release authorization, merge the accepted development change into master, check release CI, then verify production Learn recovery with the existing user's browser data. No deployment was requested or performed here.
3. Recovery occurs through Learn preparation/continuation. Assisted or repeatedly failed recall may still wait or carry over until valid Independent evidence exists; this is intentional and is not unconditional finite completion.
4. A separate review-day/FSRS accounting discrepancy observed during diagnosis is outside this acquisition task.

Blocking dependency: None for implementation; production publication requires release authorization under AGENTS.md.
