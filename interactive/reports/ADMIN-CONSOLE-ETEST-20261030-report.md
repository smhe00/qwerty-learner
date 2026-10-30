---
protocol_version: '1.1'
task_id: ADMIN-CONSOLE-20261030-ETEST
status: IN_PROGRESS
executor: Codex-admin-console
target_branch: edgeone-test
base_commit: 4073b36d7264f923fedae656e983f39edfd3cf07
candidate_commit: "Commit introducing this report (resolve with git log --diff-filter=A --format=%H -- interactive/reports/ADMIN-CONSOLE-ETEST-20261030-report.md)"
release_to_master: false
---
# Admin-only login and etest promotion

Owner explicitly requested etest, then clarified only admin login should enter the management interface. The original main-only scope is superseded for staging; master remains untouched. CURRENT_TASK/Circle ownership is unchanged.

## Pre-push findings and fix

4073b36 passed exact-SHA Pages/cloud admission, published regression, both full visible-UI matrices, feedback, recovery and workspace tests. Later Mobile P0 failed two login-clarity assertions because the ordinary account form displayed the newly added administrator link (55 other account scenarios passed). This was an actual presentation boundary conflict; assertions remain unchanged.

Remove the link from shared PC/mobile ordinary account presentation. Successful canonical admin login still diverts before workspace switching or sync. Separate console sessions accept canonical admin usernames only; a forged local admin identity still requires fresh server authorization. Existing legacy SMHE hints stop learning startup but request explicit admin re-login instead of admitting the old session automatically. Existing canonical admin credentials can be resumed only after fresh server verification.

## Focused validation

- Production EdgeOne build and CSS ownership: PASS.
- Scoped ESLint and diff whitespace checks: PASS.
- Login pipeline contracts: 10 PASS, including admin diversion without workspace changes or V4/M3/M4 execution.
- Production admin UI: 30 PASS across six device/theme profiles, including new legacy-SMHE re-login requirement, forged identity denial, normal credentials preservation and zero learning DB/sync activity.
- The two previously failing mobile-ui-clarity tests: 2 PASS against the production bundle, 360px light/390px dark, unchanged assertions.
- A separate dev-server attempt produced an incomplete log without a final summary; it is not counted as passing evidence. The explicit production run above completed with two passing results.
- Backend implementation is unchanged from 4073b36; its actual CI Cloud Sync Gate passed. New exact-SHA main CI/admission must complete before staging promotion.

## Promotion checkpoint / exact next steps

1. Publish this candidate on product/main with an expected-SHA, non-force update; pre-check main is 4073b36 and etest/master both f874b146875c507f6f30097059a47bb700c761bf.
2. Wait for the candidate's exact-SHA published Pages + Cloud admission and verify no unresolved related UI failures.
3. Fast-forward edgeone-test to this same candidate using a fresh ref lease (no master update). Each etest push auto-deploys Maker; do not create additional build-only commits.
4. Confirm t.smhe.cn/source-commit.txt matches the candidate, check real admin login surfaces on phone and PC, and verify unauthorized/ordinary callers cannot read management data. Existing Branch EdgeOne Cloud E2E automatically tests disposable ordinary identities, real Blob transport, lost receipts and cleanup.
5. A privileged administrator login/reply/maintenance validation requires the actual configured administrator session; do not guess its password or describe non-admin checks as that validation. Never run destructive maintenance for a smoke check.

Evidence for subsequent deployment/results is attached to the exact candidate's GitHub checks. Local focused logs use /workspace/scratch/4c3b6e25c0cf/admin-etest-*. Main and staging promotion are owner-authorized; production is not.
