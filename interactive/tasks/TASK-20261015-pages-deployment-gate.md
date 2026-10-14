---
task_id: TASK-20261015-pages-deployment-gate
status: REVIEW
target_branch: product/main
executor: Codex
release_to_master: false
start_commit: 30e0be26c05eef1eb3c85c644e85f8e22c30270c
---

# Pages deployment evidence before browser regression

User explicitly authorized the minimal CI repair following the 2026-10-15 investigation.
This is a separate CI task; the forced-session-revocation task and its ownership remain unchanged.

## Scope and acceptance

- Wait for the actual dynamic Pages deployment for the gh-pages artifact whose full source marker matches the candidate.
- Never accept a successful deployment of another artifact or a newer product/main candidate.
- Report deployment failure with its run URL; report propagation timeout separately.
- Keep all existing browser assertions and cloud-disabled build flags.
- Apply the same prerequisite to Explorer; allow Admission enough time for deployment, propagation and browser regression.
- Validate deterministic success, pending, failed, cancelled, mismatched artifact, old live SHA, superseded candidate and API-denial paths.
- Commit/push product/main only. No master/edgeone-test ref changes, Maker deployments, credentials or cloud data operations.

## Validation

node --test tests/cloud/pages-deployment-gate.test.mjs
node --check scripts/wait-pages-deployment.mjs
node --check scripts/verify-etest-entry.mjs
YAML parsing and focused ESLint; Pages-configured yarn build; full yarn test:cloud and Linux CI.

See interactive/reports/TASK-20261015-pages-deployment-gate-report.md.
