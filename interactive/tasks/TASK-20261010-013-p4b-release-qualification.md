---
protocol_version: "1.1"
task_id: "TASK-20261010-013-p4b-release-qualification"
task_file: "interactive/tasks/TASK-20261010-013-p4b-release-qualification.md"
report_file: "interactive/reports/TASK-20261010-013-p4b-release-qualification-report.md"
target_branch: "product/main"
status: "COMPLETED"
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
- [x] P4b-0c independent per-table source-row SHA verified against V4 export;
      V3 migration/legacy format acceptance backed by Cloud CI and Maker real
      account tests. See closure notes (not a proof about pre-capture losses).
- [x] P4b-1a separate TLA S2Recovery model & production 1-device bound,
      negative-control unsafe recovery mutation proof.
- [x] P4b-1b decomposed bounded TLC: 2-device CAS and 2-account owner
      switch/journal isolation plus unsafe mutant; full Cartesian multi-device
      multi-account state-space exploration is explicitly NOT claimed.
- [x] P4b-2a implement real Playwright isolated-profile two/three-device
      shared in-process revision-CAS API tests.
- [x] P4b-2b first complete browser gate PASS (60/60):
      two-profile Push/Pull with durable FSRS and three-profile concurrent
      CAS with exactly one winning revision; no silent local data loss.
- [x] P4b-2c Chromium fault matrix 13/13 (independent contexts,
      expiry, precommit outage, lost postcommit acknowledgement, replay);
      real Maker cross-account owner checks and session revocation.
- [x] P4b-2d regression: actual mounted-browser Pull round-trip now asserts
      full logical fingerprint equals the cloud fingerprint without a user
      keystroke, and passed in Chromium recovery Gate. Root-cause attribution
      of the earlier transient initial finding is not independently proven;
      retain drift regression under S2 rollout monitoring.
- [x] P4b-3 actual Maker/Blob tests on new test13/test24 identities:
      V3→V4 pinned migration, V4 Push/Pull, CAS, owner rejection,
      session revocation; two consecutive complete PASS runs, all disposable
      accounts deleted, strict accountId allowlist restored.
- [x] P4b-4 operator migration/rollback runbook and real Maker
      V4 data-preserving code rollback PASS; production stays in strict
      allowlist mode, public S2 UI gated OFF.

## Release qualification gates (protocol qualified; GA launch is separate)
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
- [x] Formerly blocking Maker/Blob, legacy V1 protection and rollback
      exercise now have independent real production evidence; see P4b closure
      section below. Learn gate alone was not sufficient.


## Closure decision — 2026-10-11

**Task status: COMPLETED — P4b PROTOCOL/RELEASE QUALIFICATION CLOSED.
This is NOT a public S2 feature activation or general-availability signoff.**

| Gate | Evidence | Result |
| --- | --- | --- |
| Cloud backend 114 tests, lint & build | [38062061412](https://github.com/smhe00/qwerty-learner/actions/runs/38062061412) | PASS |
| Real Learn journey + full Review | [38058144882](https://github.com/smhe00/qwerty-learner/actions/runs/38058144882), [38058144893](https://github.com/smhe00/qwerty-learner/actions/runs/38058144893) | PASS |
| S1 independent browser 60 tests | [38053214157](https://github.com/smhe00/qwerty-learner/actions/runs/38053214157) | PASS |
| S2Recovery bounded TLC, CAS, account-switch and mutant | [38062253933](https://github.com/smhe00/qwerty-learner/actions/runs/38062253933) | PASS (bounded) |
| Chromium independent profiles, V3 migration consent and crashed Pull replay | [38085865247](https://github.com/smhe00/qwerty-learner/actions/runs/38085865247) | 13/13 PASS (mock CAS) |
| Maker isolated V1 deny + compatibility | [38061862646](https://github.com/smhe00/qwerty-learner/actions/runs/38061862646) | PASS |
| Maker V3→V4, V4 Push/Pull, CAS and recovery | [38085108313](https://github.com/smhe00/qwerty-learner/actions/runs/38085108313) | two complete PASS runs |
| Maker data-preserving rollback, old V1 guard, restored strict V2 | [38086096338](https://github.com/smhe00/qwerty-learner/actions/runs/38086096338) | PASS |
| Real Maker dual Chromium S2 pilot guard | [38086365378](https://github.com/smhe00/qwerty-learner/actions/runs/38086365378) | PASS (read-only) |

**Final production release boundary:** Maker `master` at
`7818e2a51bafce48a7c8e6996fd451847f59b4cc`; server V4 write
authorization is the original strict `S2_SYNC_WRITE_ACCOUNT_IDS`
userId allowlist, default deny, without temporary usernames or diagnostics.
S2 UI production activation flag remains OFF. Dev `product/main`
contains tests and reporting changes that do not justify another Maker build.

**New P0 general-availability blocker:** remote session takeover currently
invalidates old tokens correctly but does not globally detect revocation,
show a force-logout dialog or safely transition account workspace to
anonymous on user confirmation. Follow-up:
`interactive/tasks/TASK-20261011-014-forced-session-revocation.md`.

**P1 reliability:** first actual Maker V3→V4 implicit migration denial
returned intermittent HTTP 500; subsequent two full real suites PASS.
Follow-up:
`interactive/tasks/TASK-20261011-015-maker-intermittent-500.md`.

**Additional rollout requirement:** an *enabled* S2 UI running on the real
Maker with independently logged-in durable browser profiles still
needs an explicit release Gate. Do not imply that simulated Chromium
and real Maker API tests jointly prove this integrated GA journey.

**Approval:** user explicitly requested P4b closure. This authorizes
closing the bounded qualification stage and continuing P0 readiness
work; it does NOT authorize turning S2 on for every account.
