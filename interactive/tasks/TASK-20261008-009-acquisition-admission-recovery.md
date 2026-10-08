---
protocol_version: "1.1"
task_id: "TASK-20261008-009-acquisition-admission-recovery"
title: "Repair acquisition admission and stranded tail recovery"
status: "REVIEW"
target_branch: "product/main"
base_commit: "9002ed6800f334e86fed9a72b85da9cdef8ba88f"
executor: "codex"
allow_parallel_executors: false
report_file: "interactive/reports/TASK-20261008-009-acquisition-admission-recovery-report.md"
release_to_master: false
priority: "P1"
---

# Acquisition incident repair

User authorized implementation after investigation of the October 8 production incident (build 74235a0).

## Objective and scope

Unify final acquisition progression with persisted valid admission evidence. ESC/reveal/Hint copy completion must never fabricate mastery. Recover historical complete checkpoints that have no valid admission so their words remain schedulable. Avoid immediate tail probes known to lack spacing; preserve the five-minute delayed independent recall requirement and explicit daily target.

## Constraints

- Work only on product/main; no master push or deployment.
- Preserve raw history, valid admissions, exclusions, fresh quota, and ordinary Typing behavior.
- Do not commit the user's diagnostic package or personal records.
- Do not mark persistent failures mastered or claim unconditional completion without valid independent evidence.

## Acceptance criteria

1. The incident's ESC/copy path cannot become complete or enter FSRS.
2. A clean spacing-eligible independent record completes identically in the controller, admission gate and daily progress.
3. A stranded complete checkpoint without admission becomes a pending Supported task; admitted and excluded words stay out.
4. A one/two-word Supported tail avoids an immediate spacing-ineligible independent retry and resumes a valid independent probe after the delay.
5. Browser regression proves ESC/copy cannot strand a word and historical false completion can recover.
6. Matching regression catalog and gate manifest references remain executable.

## Validation

Run acquisition/domain/daily/recovery and relevant simulation suites, new browser regressions, Typing control, lint, gate-manifest validator, and build. Record exact outcomes and unrun checks in the report. Fetch before push, integrate safely, and push coherent commits to product/main.
