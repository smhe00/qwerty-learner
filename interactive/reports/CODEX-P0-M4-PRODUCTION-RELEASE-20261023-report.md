# M4 production release checkpoint — 2026-10-23

Status: RELEASED / VERIFIED on canonical production https://q.smhe.cn/.
Final application SHA: `a2dc907c9c0f6e8924f441fa360ebabd317233dd`.
Production three-device acceptance completed 2026-10-23 22:35:15 Asia/Shanghai.
Owner authorization: “如果需要发布，你来推进”, after complete etest acceptance.
Executor: Codex, single writer. Base application: `01ed8574da7a231482bf6911038a1fe04e277392`.
Master at intake: `6d7839b9a9fd7a31459a19aeca948227b1f7b3c2`.

## Final result and release sequence

The owner authorized the necessary release after the earlier isolated etest
success. All required final-candidate safety checks passed before product/main
advanced. Actual published Pages and Cloud admission then passed; edgeone-test
advanced to the identical SHA and passed its real transport, relay, writeback
and hard three-device gates. Only then was master normally fast-forwarded from
6d7839b9 to the SAME a2dc907c commit. No force push, new merge SHA or gate waiver.

- Root seal repair: `51868a7ef1a1414fa963db6f871aa39e613afb7e`.
- Production-origin policy: `b6f5de0bdb921b21b90154fc1253442c54774863`.
- Final qualified application/test SHA: `a2dc907c9c0f6e8924f441fa360ebabd317233dd`.
- Development PR: https://github.com/smhe00/qwerty-learner/pull/30 .
- Production release PR: https://github.com/smhe00/qwerty-learner/pull/31 .
- The final report-only commit stays on the diagnosis branch. Keep application
  branches pinned to the qualified SHA; do not redeploy to publish this report.

## Exact-final-SHA validation

| Check | Actual result | Evidence |
| --- | --- | --- |
| Complete candidate safety | PASS: Cloud 553/553, S1 115/115, full Review with 116/116 browser tests, full Mobile, lint/build | https://github.com/smhe00/qwerty-learner/actions/runs/39965456028 |
| Block feature gate | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39965464868 |
| Performance gate | PASS on full unchanged rerun after one cold 5-second visibility timeout | https://github.com/smhe00/qwerty-learner/actions/runs/39965464972 |
| Published Pages deployment and real browser regression | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39967365157 |
| Cloud backend and exact-SHA Pages/Cloud admission | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39967365199 |
| Etest read-only admission | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39967365492 |
| Standalone S1 | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39967365255 |
| Standalone Review | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39967365518 |
| Standalone Mobile | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39967365202 |
| P4b recovery | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39967365302 |
| Architecture / Achievement | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39967365404 , https://github.com/smhe00/qwerty-learner/actions/runs/39967365378 |
| Learn real journey / published dual-site Explorer | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39967365572 , https://github.com/smhe00/qwerty-learner/actions/runs/39967365360 |
| Etest single-session revoked-token relay | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39968233593 |
| Etest safe six-table V4 / Good+Again FSRS / CAS writeback | PASS in a new disposable-account attempt; first failed-closed attempt retained | https://github.com/smhe00/qwerty-learner/actions/runs/39968233613 |
| Etest HARD three real Learn profiles | PASS: A/B/C each exact 3/3; no pending M4 journal; cleanup200/accountDeleted:true | https://github.com/smhe00/qwerty-learner/actions/runs/39968233610 |
| Real Blob/S1 browser and mandatory same-SHA release-ready | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39968233583 |
| Actual canonical production source/gateway | PASS | https://github.com/smhe00/qwerty-learner/actions/runs/39970051275 |
| HARD canonical production Footer/assets + three-device real Learn | PASS: 34 successful JS responses; A/B/C each exact 3/3; cleanup200/accountDeleted:true | https://github.com/smhe00/qwerty-learner/actions/runs/39970051251 |

The new production workflow verified the real source marker and single-session
event gateway BEFORE account creation. A fresh browser rendered the matching
Footer version and loaded 34 production scripts successfully. Three independent
profiles then performed genuine Learn input offline. Revoked A/B sessions kept
their durable attempts; only explicitly reauthenticating the same account
restored cloud access. Sequential A/B/C/A/B/C reauthentication required no manual
Sync, forced reload or test writes to IndexedDB. All original dictionary/word/
timestamp facts remained exact once each. Each profile's trace includes finalize.

```json
{"origin":"https://q.smhe.cn","source":"a2dc907","authMode":"single-active-session","eventPilotMode":"immutable-events-only","loadedScripts":34,"profiles":[{"index":0,"localRows":3,"journal":{"pending":false},"finalized":true},{"index":1,"localRows":3,"journal":{"pending":false},"finalized":true},{"index":2,"localRows":3,"journal":{"pending":false},"finalized":true}],"cleanup":{"status":200,"accountDeleted":true}}
```

Production redacted artifact: `production-3way-sync-39970051251`, ID 12509430697,
retained until 2026-11-06. Etest artifact: `etest-3way-auto-fork-39968233610`,
ID 12507458270, retained until 2026-10-30. Run logs contain the same fixed
phase/counter evidence. No tokens, attempt UUIDs, account IDs or words are
exported in these diagnostic artifacts. Acceptance used only newly created
disposable identities; it did not log into existing users' accounts.

## Retained failed attempts and safety behavior

The earlier b6f5de0b first attempt and the readiness-probe diagnosis are retained
below. Final a2dc907c passed complete S1 and Review independently, including the
original cold-start assertion and all M4 guarded restore/seal/finalize crashes.

On a2dc907c the separate safe V4 pilot initially received the fixed
`v4_direct_body_read_failed` 503 on an intentionally stale ReviewSession POST.
The handler raises that code BEFORE calling putSyncV4Binary. The generic test
uploader reread metadata, refused to replay the write on a mismatched baseline
and failed the run. Its finally cleanup completed: disposeIsolatedMergeAccount
returns only after authenticated identity verification and DELETE200 with
accountDeleted:true; the completed log contains no cleanup-failure marker.
We did not replay that request. The full experiment was rerun on the SAME SHA
using a NEW run-attempt-specific disposable account and passed every original
CAS, fingerprint, FSRS and foreign-key assertion. Both attempts remain visible.
This is a retained fail-closed provider transient, not a weakened test or a
claim that unknown writes may be retried. Performance's first visibility
timeout and complete passing rerun are likewise retained, with no timeout edit.

The historical DELETE500 still has no proven root cause; it did not recur in
either hard etest or production cleanup. Fixed stage diagnostics remain, and
Circle/account safety checks remain enforced.

## Scope, legacy hostname and recommendation

**GO / released and verified for canonical q.smhe.cn's supported immutable-event
adoption path.** Supported WordRecord UUID evidence is adopted monotonically
and FSRS is replayed while all local tables, sessions and settings remain
protected. Legacy rows without UUIDs, exclusions, conflicting/unknown evidence
and unreplayable states retain their existing conservative blocks. The path
does not certify whole-account completeness or automatically replace cloud V4.

The separate historical `https://qwerty-plus.edgeone.dev/` hostname was probed
read-only after release and still served `2f80afb`, without the new event
capability. It is **NOT qualified** for this release. Its policy allowlist entry
has no effect while its old code is served. We did not change that Maker
project, redirect it, inspect user accounts or assume shared Blob namespaces.
Any legacy-host deployment or account/data migration needs a separately pinned
target and data-safe plan. The verified production URL is q.smhe.cn.

Inherited automatic checks remain visible and are not reported PASS here:
Maker V4 Migration Live Readiness (39970051131) hard-codes that historical
hostname and probes a blank-profile migration route; EdgeOne Browser Sync Gate
(39970505184) uses an unread repository-secret URL and historical V1 UI fixtures.
The Maker check FAILED with `old frontend without supervised S1 migration route`
at 22:42 Asia/Shanghai; the inherited Browser Sync check was still installing
Chromium at this checkpoint. No PASS is claimed for either, and neither supplies
canonical-site acceptance evidence. Advisory Pages Explorer (39967365417) was cancelled; the
required published Pages regression and independent dual-site Explorer passed.
Do not hide or weaken these checks; retarget/repair legacy verification in a
separate focused change rather than claiming its old deployment passed.

## Historical implementation checkpoint

## Why another candidate is necessary

The accepted seal fix passes real etest, but multiple browser entry points still
check t.smhe.cn. Publishing that SHA alone would not activate production automatic
adoption. A shared exact-origin policy now connects the same data path on the
two known production origins; Pages and explicit cloud-disable retain priority.
No merge, journal, FSRS, legacy, full-V4, session, account or Circle checks change.

The real three-device test is reused for production with two independent admission
conditions: master branch plus the dedicated production acceptance flag and exact
q.smhe.cn URL. It validates deployed SHA and backend policy before creating a
unique disposable account; only that verified identity may be deleted. The
production workflow waits for actual deployment before running it.

## Validation and next step

Local Cloud contracts: 553/553 PASS, including four origin/disabled-build checks.
Production bundle PASS. Sync/entry-point lint: zero errors, existing warnings only.
Production preflight syntax check and hard-browser test discovery PASS.
Complete candidate CI pending. No master promotion until the
identical candidate passes Pages + Cloud admission and complete etest including
the hard three-device gate and release-ready. After authorized promotion, require
production source/assets/health and real three-device acceptance before claiming
the release verified. The final record will be a report-only diagnosis-branch
commit so it does not invalidate the tested/deployed application SHA.

Candidate `b6f5de0bdb921b21b90154fc1253442c54774863` first CI attempt passed
Cloud 553/553, complete Mobile, Block and Performance. S1 was 114/115, failing
only the first app's default five-second visibility wait; all M4/P4b tests passed.
Review was 115/116 with an old queue-repair readiness timeout. Three local repeats
passed, then a failure was reproduced with DOM and Playwright trace evidence:
the real word and unfinished four-word repaired record were ready, while
`locator.isEnabled` waited about 45,216 ms for the removed `开始 Learn` button.
Unlike `isVisible`, this call auto-waits for a missing element. The helper now
checks visibility and bounds only that individual enabled probe to 250 ms, so
the unchanged 45-second poll can observe successful auto-resume. It never forces
a disabled click; durable queue completion/record assertions remain unchanged.
This test-only correction requires complete exact-final-SHA CI again. Original
failures are retained in run https://github.com/smhe00/qwerty-learner/actions/runs/39961764603 .
The same b6f5de0b S1 rerun passed 115/115 with no source, timeout or assertion
change (job 120447913061). After the bounded readiness-probe correction, the
original strict old-queue scenario passed 5/5 local repeats, including complete
five-word-round completion and durable-state checks. Application source is
unchanged from b6f5de0b; the following candidate changes only this test helper
and the checkpoint, and will independently rerun all required gates.

## Remaining limits

Only supported UUID-based immutable learning events are automatically adopted.
Legacy rows, exclusions, unreplayable FSRS and contradictory evidence still block
adoption without deleting local data. The flow does not certify whole-account
completeness or overwrite cloud V4 from partial discovery. The earlier DELETE500
cause remains unproven; current strict cleanup passes on the old accepted SHA,
and failure-stage diagnostics are preserved. Network/body-read failures retain
existing bounded retry rules; uncertain writes are not blindly repeated.
