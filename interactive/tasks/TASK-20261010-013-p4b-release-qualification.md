---
protocol_version: "1.1"
task_id: "TASK-20261010-013-p4b-release-qualification"
task_file: "interactive/tasks/TASK-20261010-013-p4b-release-qualification.md"
report_file: "interactive/reports/TASK-20261010-013-p4b-release-qualification-report.md"
target_branch: "product/main"
status: "ACTIVE"
executor: "ChatGPT (direct executor)"
release_to_master: false
priority: "P0"
---

# P4b — Safe rollout / release qualification

## Nonnegotiable constraints
- `product/main` development, `master` Maker release ONLY on explicit user approval.
- Never issue real Maker cloud writes or delete real accounts in P4b-0/1/2.
- Do not equate local fake cloud with EdgeOne or Blob real availability.
- No silent V1/V3 upgrade or divergent-side merge/overwrite; consent
  and locally downloaded original backup required.
- Preserve S1 WebLock, owner/generation check and crash journal.
- Treat any Learn Real Journey or Review Gate failure as release blocking
  until reproducible/isolated; do not relabel it green.

## Stages
- [x] P4b-0a six-table export source-count versus snapshot row counts,
      quantitative per-table SHA diagnostic helper.
- [x] P4b-0b post-Pull actual RecordDB+runtime canonical fingerprint
      verification before reseal/baseline CAS; failure leaves journal.
- [ ] P4b-0c additional row-schema semantics and independent per-table
      source row hash verification, V3 historical shape coverage.
- [x] P4b-1a separate TLA S2Recovery model & production 1-device bound,
      negative-control unsafe recovery mutation proof.
- [ ] P4b-1b multi-device / multi-account bounded TLC and failure
      projection / coverage report.
- [x] P4b-2a implement real Playwright isolated-profile two/three-device
      shared in-process revision-CAS API tests.
- [x] P4b-2b first complete browser gate PASS (60/60):
      two-profile Push/Pull with durable FSRS and three-profile concurrent
      CAS with exactly one winning revision; no silent local data loss.
- [ ] P4b-2c expand concurrent crash/old-login/foreign-account,
      session expiry, server response-loss and offline matrices.
- [ ] P4b-2d resolve post-Pull APP HYDRATION logical fingerprint drift:
      actual six-table learning rows and baseline match restored cloud but
      immediate app mount can change full logical fingerprint absent a user
      keystroke; classify before adopting no-op/push production policy.
- [ ] P4b-3 once after local Gate approval, disposable-account *actual*
      EdgeOne Maker + Blob isolated verification.
- [ ] P4b-4 operator S1/legacy-tab migration/rollback runbook, final
      release decision and explicit approval to update `master`.

## Release qualification gates (not all complete)
G1 cloud tests + lint/build, G2 all browser contracts, G3 Learn/Review/
Typing/Achievement, G4 formal safety model, G5 real Maker 3 devices,
G6 historic cloud V3 migration/rollback, G7 stale V1 client protection,
G8 rollback recovery exercise and user signoff.


## P4b G3 regression — Learn Real Journey now green
- [x] Fail 38056826487 independently triaged from CI trace: cold
      S1/bootstrap + unready Typing word queue, not a demonstrated
      multiword progression data defect.
- [x] Fix `b18dad6b7fa9ecff40e59d1b9ce652d191b639bc`:
      wait for active review and first word; verify three seed names and
      index before typing. Do not relax remaining assertions.
- [x] Learn Real Journey 38058144882 PASS: full keyboard-to-durable plus
      4 targeted real browser Review/FSRS/Hint/ESC checks.
- [ ] Full P4b release qualification still blocked on Maker/Blob gray
      rollout, legacy client protection, and rollback exercise; the
      Learn Gate passing alone cannot complete P4b.
