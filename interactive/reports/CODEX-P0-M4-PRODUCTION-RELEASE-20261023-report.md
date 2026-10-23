# M4 production release checkpoint — 2026-10-23

Status: IN_PROGRESS / NOT RELEASED.
Owner authorization: “如果需要发布，你来推进”, after complete etest acceptance.
Executor: Codex, single writer. Base application: `01ed8574da7a231482bf6911038a1fe04e277392`.
Master at intake: `6d7839b9a9fd7a31459a19aeca948227b1f7b3c2`.

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
