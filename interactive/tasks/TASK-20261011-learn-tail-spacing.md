---
protocol_version: "1.1"
task_id: "TASK-20261011-learn-tail-spacing"
target_branch: "product/main"
status: "REVIEW"
executor: "Codex"
claim_base_commit: "855d9ae5a4b4b7f8c7d8d4299930a00b9ecf3a58"
release_to_master: false
---

# Learn tail scheduling incident

Explicit user task on 2026-10-11: inspect the uploaded incident captured at
04:11:56 UTC, fix repeated 1–3 word blocks and repeated multi-minute spacing
waits after fresh introductions finish, add regressions, report commits and
verification. This is independent of CURRENT_TASK's forced logout work; its
pointer and ownership must remain unchanged.

## Scope and acceptance

- Inspect the incident against product/main (incident build 855d9ae).
- Stop cooled assistance-deferred words from reopening Supported and adding
  a second five-minute spacing delay solely because the block has a short tail.
- Coalesce nearby deferred deadlines without premature admission or unbounded
  waiting; selection and waiting must use the same policy.
- Preserve clean independent evidence, fresh quota, immutable history and Typing.
- Cover 1/2/3 word tails, pre-deadline blocking, failed probes and bounded cohorts.
- Validate Learn domain/simulation tests, browser acquisition flow, lint and build;
  distinguish baseline type failures. Commit/push product/main only; no release.

Report: ../reports/TASK-20261011-learn-tail-spacing-report.md
