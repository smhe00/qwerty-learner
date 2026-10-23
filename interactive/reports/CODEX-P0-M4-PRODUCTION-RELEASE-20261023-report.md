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

## Remaining limits

Only supported UUID-based immutable learning events are automatically adopted.
Legacy rows, exclusions, unreplayable FSRS and contradictory evidence still block
adoption without deleting local data. The flow does not certify whole-account
completeness or overwrite cloud V4 from partial discovery. The earlier DELETE500
cause remains unproven; current strict cleanup passes on the old accepted SHA,
and failure-stage diagnostics are preserved. Network/body-read failures retain
existing bounded retry rules; uncertain writes are not blindly repeated.
