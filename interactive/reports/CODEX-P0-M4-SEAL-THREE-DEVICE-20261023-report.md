# P0 M4 seal diagnosis — 2026-10-23

Status: COMPLETE — reported M4 seal fault fixed; exact-SHA real etest acceptance PASS.
Validated application SHA: `01ed8574da7a231482bf6911038a1fe04e277392`.
Root-fix SHA: `51868a7ef1a1414fa963db6f871aa39e613afb7e`.
product/main and edgeone-test both serve the validated application SHA. master remains
`6d7839b9a9fd7a31459a19aeca948227b1f7b3c2`; no production release was made.
The intake and intermediate sections below preserve historical findings, including failures
and then-pending checks. This final checkpoint supersedes their pending status.

## Final real-network acceptance — 2026-10-23 13:14 UTC

The owner confirmed deployment, and the actual `https://t.smhe.cn/` source marker matched
`01ed857`. Backend preflight confirmed `single-active-session` before test-account creation.
All acceptance runs below use the identical full application SHA above.

| Required evidence | Result | Exact run |
| --- | --- | --- |
| Full S1, including M4 guarded seal/crash replay and P4b cases | 115/115 PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39956351099 |
| Cloud contracts, sync/backend lint, production build | 549/549 PASS; lint/build PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39956351099 |
| Complete Review workflow, contracts/simulation and browser suite | PASS; browser 116/116 | https://github.com/smhe00/qwerty-learner/actions/runs/39956351099 |
| Complete Mobile P0 workflow | PASS; learning 50, account 28, Pages-disabled 4 browser cases | https://github.com/smhe00/qwerty-learner/actions/runs/39956351099 |
| Block Auto Sync feature gate | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39956358453 |
| Performance branch gate | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39956358477 |
| Published Pages deployment and regression | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39958188619 |
| Cloud Sync and exact-SHA Pages/Cloud staging admission | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39958188587 |
| Standalone P4b browser recovery release gate | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39958188666 |
| Standalone product/main Review gate | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39958188670 |
| Single-session M3 A→B→A relay, revoked tokens return 401 | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39958673925 |
| Real V4 safe candidate writeback, stale CAS 409, six-table joins/FK, chronological FSRS replay and independent readback | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39958673966 |
| HARD three real Learn profiles: offline forks, staged reauth, automatic local V4 adoption | PASS; each A/B/C has exact 3/3 immutable attempts | https://github.com/smhe00/qwerty-learner/actions/runs/39958673863 |
| Real Blob transport/large-payload endurance, S1 account browser suite, account cleanup | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39958673832 |
| Mandatory same-SHA Pages + etest release-ready | PASS; `releaseAuthorized:false` | https://github.com/smhe00/qwerty-learner/actions/runs/39958673832 |

The hard test performed genuine Learn input on three independent browser profiles,
went offline for separate durable attempts, reconnected simultaneously and verified
revoked sessions could not use cloud. It then used sequential A/B/C/A/B/C reauthentication
without manual Sync, overwrite selection, test writes to IndexedDB or forced reloads.
Every profile retained each original attempt exactly once with identical dictionary,
word and timestamp. The final redacted evidence is:

```json
{"profiles":[{"index":0,"localRows":3,"journal":{"pending":false}},{"index":1,"localRows":3,"journal":{"pending":false}},{"index":2,"localRows":3,"journal":{"pending":false}}],"cleanup":{"status":200,"accountDeleted":true}}
```

Actual phase traces now contain `seal`, `finalize`, `complete` and `adopted`.
The repeated reauthentication of an already-complete profile reports
`all-witnessed-attempts-already-local`, preserving the three-record count.
Read-only evidence artifact `etest-3way-auto-fork-39958673863` (artifact ID
`12503941935`) is attached to the hard-test run and expires 2026-10-30.
The job log retains the same redacted trace. Background blocked/exception entries
also remain visible around session handoffs; they were not suppressed to pass.
They did not prevent adoption or leave pending M4 transactions in this accepted run.

### Cleanup finding and remaining limits

The former DELETE 500 did **not** recur in this exact-SHA acceptance: the hard test
received HTTP 200 and `accountDeleted:true`; other real-network suites also passed
their strict disposable-account cleanup. The historical 500 is still not assigned
a proven root cause. The patch adds fixed failure-stage diagnostics and preserves
fail-closed Circle/account ownership checks; it is not presented as a proven fix
for an unobserved deletion exception. Any recurrence must remain RED and be
investigated from its independent cleanup-stage evidence.

Real EdgeOne runs still observed transient body-read failures and an explicit login
500, recovered only through existing bounded retry rules. This successful staging
run does not establish production reliability or arbitrary account completeness.
M4 adopts a verified immutable-event prefix while preserving the entire local V4
snapshot; it is not a global history certificate or permission to overwrite cloud
from an incomplete Blob listing. The separate writeback pilot covers its existing
safe subset and real CAS; complex concurrent DailySession/chapter/achievement
changes retain their conservative gates. The old closed-profile `A=0` incident
cannot retrospectively prove preservation or loss.

### Release recommendation and persistent handoff

- **GO for the tested isolated etest scenario:** the reported seal failure and
  three-device offline automatic adoption failure now have exact-SHA passing proof.
- **NO-GO for enabling automatic convergence in production as part of this task:**
  production hostname activation and broader reliability qualification remain
  separate decisions. No master publication or production account/Blob write occurred.
- PR: https://github.com/smhe00/qwerty-learner/pull/29 . The tested code was promoted
  by normal fast-forward after complete safety gates, then published Pages/Cloud
  admission, then isolated etest verification. User continuation and deployment
  confirmation supplied the staging authorization. No force push or gate bypass.
- Root behavior change: `src/sync/workspace-storage-witness.ts`; safe diagnostic:
  `src/sync/m4-witnessed-prefix-browser.ts`. Real browser regression/harness,
  hard three-device assertions/evidence and account failure-stage tests accompany it.
  CI fixture/alignment corrections and full workflow invocation are documented below.
- The final report/handoff update is documentation only on the diagnosis branch.
  Leave product/main and edgeone-test pinned to the validated application SHA;
  do not redeploy merely to publish this report. Future work should start from the
  validated application commit and preserve this report as evidence.

## Historical investigation and intermediate checkpoints

## Verified intake

- Diagnosis branch: `67beceaa85ad431c3fa3dc456efbac1ed09e1841`.
- product/main and edgeone-test: `1a70bfe219af1fef187fcd4b71484332415a291f`.
- master: `6d7839b9a9fd7a31459a19aeca948227b1f7b3c2`.
- Read the complete handoff, AGENTS, CURRENT_TASK, referenced task/report and convergence checkpoint.
- Existing failing staging evidence: https://github.com/smhe00/qwerty-learner/actions/runs/39937158658 . The final cleanup 500 concealed the application error.

## First proven cause

`installWorkspaceStorageWriterGuard()` replaces `Storage.prototype.setItem` and rejects direct writes to the migration witness. `refreshWorkspaceMigrationWitness()` used that same public method. Account-management boot installs the guard before reauthentication; its pre-mount M4 transaction therefore completes restore and exact full-V4 readback, then throws in seal before finalize.

Reproduced against the original source in real Chrome/IndexedDB with the S1 lease and installed guard. Fixed diagnostic chain: `executeM4Merge -> recoverM4Merge -> replica.seal -> refreshWorkspaceMigrationWitness -> guarded Storage.setItem`. Wrapped cause: `S1 migration witness is managed by the guarded writer only`.

Redacted original-source reproduction:

```json
{"errorCategory":"guard-rejected-managed-seal","phases":["capture","stage","restore","verify","seal"],"pending":true,"rollbackIntact":true,"candidateIntact":true,"exactCandidate":true,"sealed":"sealed","rejectsSet":true,"rejectsRemove":true,"rejectsClear":true}
```

The prior M4 browser tests ran without installing this guard. The fix keeps a private managed-refresh closure using the original setter captured by the guard. Public set/remove/clear restrictions remain enforced; no ownership, full-V4 verification, source-row audit or journal CAS was relaxed.

## Recovery and evidence boundary

- Real-IDB regressions inject interruption at restore, seal and finalize under the guard. Both full snapshot fingerprints are checked before reload; actual S1 boot must restore the exact candidate before mounting, require a reload, clear the pending journal only after verification and make a second replay a no-op.
- Explicit rollback, foreign owner rejection and scratch six-table Typeson parity remain covered.
- These tests prove journal retention/recovery for the reproduced fault. The old CI profiles were closed without a journal artifact, so the historical `A=0` observation cannot prove either permanent loss or intact rollback on that specific profile.
- New staging failure evidence independently reads the durable vault and reports only six-table counts and snapshot-integrity booleans. It never exports account/device IDs, attempt UUIDs, tokens, words or snapshot payloads.

## Three-device and cleanup reporting

- Keep single-active-session and sequential reauthentication. No manual Sync or test writes to RecordDB.
- Strengthen final verification to exact 3/3 attempts on **each** A/B/C profile, with original immutable fields preserved once each.
- Retain application and cleanup errors independently; Playwright 1.40 requires explicitly preserving both assertion stacks because it does not serialize AggregateError.errors.
- Write the redacted artifact expected by the existing upload step.
- DELETE 500 is **not fixed or explained yet**. Add only fixed failure-stage diagnosis (identity, Circle activity guard, body read, content deletion). A failed Circle safety check remains RED and cannot authorize deletion. Only disposable accounts may be cleaned up.
- Repair the pre-existing Windows `URL.pathname` test-entry bug with `fileURLToPath`, allowing all route integration tests to execute locally.

## Local validation at initial patch

| Check | Actual result |
| --- | --- |
| Cloud contracts | 549/549 PASS |
| Modified frontend sync + backend lint | PASS |
| Production bundle | PASS |
| M4 guarded seal | PASS, phases include finalize and complete; full-V4 fingerprint exact |
| Full S1 | 114/115 PASS; first legacy-app startup visibility assertion still under investigation |
| M4/P4b cases inside S1 | All PASS, including guarded restore/seal/finalize interruptions |
| Mobile P0 browser suite | 41/41 PASS |
| Review browser suite | Running at checkpoint |
| Exact-patch Pages / etest / release readiness | NOT RUN; no promotion or release |

Local logs and synthetic traces remain in the isolated checkout's `.diagnostic/` and ignored test outputs; no user data or credentials are committed. The branch-only `P0 M4 Diagnosis Safety` workflow runs Linux Cloud/lint/build and full S1 without deploying, creating accounts, changing release status or bypassing existing gates.

## Next action / release recommendation

Integration checkpoint:

- Root fix commit: `51868a7ef1a1414fa963db6f871aa39e613afb7e`, review draft https://github.com/smhe00/qwerty-learner/pull/29 .
- Its Linux Cloud contracts/lint/build passed in https://github.com/smhe00/qwerty-learner/actions/runs/39941969050 ; full S1 was still running at this checkpoint.
- The local startup-only diagnosis mounted the unchanged application after 8.3 seconds. The original S1 5-second assertion was NOT changed; Linux CI is the independent arbiter.
- PC/mobile account browser coverage passed 28/28 on the root fix. Local Review was interrupted before integrating upstream and is not claimed PASS.
- product/main advanced independently to `a501625f6e1928668c2f5df372ff852a583176ac` with two unrelated mobile ergonomics commits. These were merged **into the diagnosis branch only**, without conflicts, in `5f2f62e38d5f88a59d6c40d38708d668edb2818e`.
- The diagnosis workflow now invokes the COMPLETE existing Review and Mobile P0 workflows through `workflow_call`, alongside Cloud and full S1. Their existing commands, assertions and deployment/release gates are unchanged. Verify the new final SHA's run before promotion; earlier mobile results cover the old upstream only.
- Diagnostic IDB open operations abort database creation if a store is absent; evidence collection never repairs or manufactures a profile.
- PR Learn Block gate exposed an existing obsolete fixture: it mocked legacy JSON `PUT /api/sync/v2`, while the client sends `POST /api/sync/v2/binary/direct`. Reproduced the failure locally; updated only the fixture to verify native gzip bytes, payload SHA, logical fingerprint, base revision, owner and all six tables. The unchanged handoff/disabled-toggle assertions now pass 2/2. See prior failing run https://github.com/smhe00/qwerty-learner/actions/runs/39942129364 ; verify the final commit's new run, not this historical failure.
- Candidate `b381eccc41c531030d98912ea30d1b4e4313b234` passed Linux Cloud 549/549, S1 115/115 (including P4b and all new M4 tests), complete Mobile P0 (50 learning, 28 account, 4 Pages-disabled browser tests), Block gate and Performance gate. Evidence: https://github.com/smhe00/qwerty-learner/actions/runs/39942714538 , https://github.com/smhe00/qwerty-learner/actions/runs/39942718459 , https://github.com/smhe00/qwerty-learner/actions/runs/39942718455 . Complete Review reached 114/116 browser tests after passing its contracts, simulation, fuzz, audio and build steps.
- Review's two failures were investigated rather than waived. The old-queue repair had already restored a live unfinished practice record, but the helper waited 45 seconds for a transient disabled Start button which successful auto-resume removed. It now waits for either the real word or an enabled Start, without a forced click or longer timeout. The header's 4.48px displacement comes from unequal chapter/exercise slot widths; give the Typing chapter a 5rem minimum matching the Learn exercise control. Keep the original 4px assertion unchanged. The three targeted browser scenarios passed locally; the following final SHA must rerun complete gates.
- The user's subsequent instruction to continue authorizes proceeding through the described product/main Pages and isolated etest validation once the complete safety gates pass. master remains forbidden. Until those gates actually pass, do not promote.

1. Inspect the branch-only Linux safety workflow tied to the fix SHA. Resolve actual failures and finish local Review/account coverage.
2. Follow the handoff's explicit promotion boundary: only propose product/main and edgeone-test promotion after safety passes. Existing same-SHA Pages + Cloud admission and all mandatory release checks must remain unchanged.
3. On an authorized etest promotion, verify `https://t.smhe.cn/` source marker and single-session backend before creating disposable accounts. Run the strengthened hard three-device test; inspect independent cleanup-stage evidence if DELETE still fails, fix the actual cause and rerun the complete gate.
4. Until full exact-SHA Pages, P4b, S1, Review, mobile, Cloud, real transport and hard three-device acceptance pass, recommendation is **NO-GO**. No master release authorization exists.
