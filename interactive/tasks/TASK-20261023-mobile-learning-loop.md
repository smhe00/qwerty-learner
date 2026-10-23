---
protocol_version: "1.1"
task_id: "TASK-20261023-mobile-learning-loop"
status: "REVIEW"
target_branch: "product/main"
base_commit: "e6c7800ba93c14d1f0443c66d5d0481a133e3fa6"
executor: "Codex (independent mobile UI task)"
report_file: "interactive/reports/TASK-20261023-mobile-learning-loop-report.md"
release_to_master: false
---

# Mobile local learning loop

Owner approved non-cloud P0 work after priority review, explicitly leaving ALL cloud sync work to another thread. Keep CURRENT_TASK untouched. Implement visible local-save failure/exit protection, mobile dictionary selection using existing catalog and IDs, basic local learning/audio settings using existing atoms, read-only today progress from existing durable evidence, and a mobile local settlement/result page. Do not edit src/sync, cloud-functions, authentication UI, sync status, transport, ownership, FSRS policy, or remote settings formats. Reuse local settlement helper only; never invoke its cloud completion function. No cloud accounts or remote writes. Push development normally; no etest/master promotion.

Acceptance: failed local flush blocks header exit and shows retry while preserving input/current word; retries preserve checkpoint. Library filtering does not mutate state; explicit switch preserves old checkpoints and resumes selected dictionary. Settings validate existing ranges and retain unrelated preferences; current daily cohort remains frozen. Home and results show persisted independent progress and avoid false success before durable local settlement. Phone/tablet routes stay stable through resize. Verify narrow screens, native forms, reload persistence, selected dictionary/state isolation, failed writes/recovery, ordinary desktop regression, lint/type/build. Physical Huawei/iOS acceptance is unverified unless actually performed.

Implementation: 1699f0b88efc2220ddb34cc2ba785599e0fcaa5a. See the report for checks and remaining physical-device acceptance.
