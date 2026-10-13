---
protocol_version: "1.1"
task_id: "TASK-20261013-circle-recovery-privacy"
status: "PARTIAL"
executor: "Codex"
target_branch: "feature/circle-core-blob"
claim_base_commit: "e9c45bd215c5b56b8449e66850bde6650920d292"
upstream_head_at_start: "9b21c0d984d42e097da67cf3191e2e54956e5ee9"
upstream_head_at_handoff: "230c463413642a28f2bbd253068091164d304567"
release_to_master: false
---

# Circle v2 recovery and privacy — execution report

## Outcome

Substantive offline implementation of the two next core gaps:
- recoverable monotonic leave/remove/close with immutable Blob intentions and
  mandatory independent bound receipts;
- server-only retired-identity event scrub and residual audit.

HTTP remains disabled. No production trusted provider, scheduler or account/V4
integration is claimed. No real store writes/deletes or Maker deployments ran.

## Source and scope

Resumed from e9c45bd215c5b56b8449e66850bde6650920d292 in the same isolated
checkout. Read AGENTS, CURRENT_TASK, previous report/design and current
event log/reducer/service/tests. The direct user feature-only assignment overrides
AGENTS product/main defaults. CURRENT_TASK and its UI executor unchanged.

Changed Circle service/event-log; added revocation.js/privacy.js; expanded active
Circle test file. No source changes to UI, V4, production gateway, dependencies,
protected branches or historical CAS implementation.

## Implemented behavior

Intention is appended before invoking the independent fence. Unknown intention
write does not trigger a fence. A fence network failure returns
circle_revocation_unknown. A reliable matching receipt authorizes only the exact
canonical final event. Recovery uses fresh keys, no lease/CAS/ack state, and
independent per-command maintenance checks, including retired-subject denial.
Partial scans never claim fullyRecovered.

Retirement scrub checks stable independent retirement fence and maintenance
privilege before every deletion. It covers author, target and nested intention
references. Active accounts cannot be purged. Owner retirement makes its Circle
unavailable without inferred owner transfer. Audits always fullyErased=false;
later-visible records and late writers require repeated cleanup.

## Validation

- node --test tests/cloud/circle-core.test.mjs: **47 pass, 0 fail, 0 skip**.
  Original 25 active tests retained; failure injection updated to distinguish
  intention vs final append. Added 22 recovery/privacy tests.
- Repository ESLint over all Circle source and active/historical tests: exit 0
  after final exception-code refinement; final rerun exit 0.
- Full tests/cloud/*.test.mjs: **175 tests, 174 pass, 1 fail**. Sole failure is
  the unchanged s2-write-route.test.mjs Windows URL.pathname/esbuild entry path
  issue also present at the prior checkpoint. The final exception-code refinement
  was verified with all 47 Circle tests afterward; no unrelated tests changed.
- git diff --check and forbidden-scope diff checked clean before docs; verify again
  before committing. No installs or shared runtime changes.
- No live store qualification, actual privacy deletion, UI build or deployment.

## Remaining release blockers / next action

Mandatory independent reliable trustedAccess provider and its retirement/receipt
lifecycle are still contracts backed only by offline mocks. Provider must commit
fence and durable receipt idempotently and authorize at its own commit point.
A general persistent scheduler, complete Circle inventory, dead-letter recovery,
retention policy, settling of pre-fence writers and complete erasure proof remain
unfinished. Final-check/response delivery and retirement-check/delete races are
not claimed globally atomic. Storage qualification and HTTP/privacy/abuse gates
remain closed. No automatic v1 migration.

Next: implement and independently qualify the trusted provider and trusted
inventory/orchestration, following docs/CIRCLE_RECOVERY_PRIVACY_V2.md. Do not
enable HTTP, merge protected branches, touch UI/V4 or deploy Maker.

## Commit procedure

Use the passed scoped tests/lint instead of the repository-wide auto-fixing hook,
which would rewrite forbidden UI/V4 files. Implementation SHA will be recorded
in a report-only follow-up commit; final handoff records exact pushed tip and
protected reference verification.

## Pre-commit reference and scope checks

Remote feature remains the claim base e9c45bd215c5b56b8449e66850bde6650920d292.
Remote product/main advanced during this turn from
9b21c0d984d42e097da67cf3191e2e54956e5ee9 to
230c463413642a28f2bbd253068091164d304567.
This executor did not commit/push that branch and did not integrate it under
the user's feature-only constraint. No upstream work was overwritten.
Remote master remains c2e8cbbb4d7a6509b956c36e4245bfab122abfea.

Final git diff --check and forbidden-scope diff: clean. Final Circle lint: exit 0.
No source changes after the passing 47-test final run.
