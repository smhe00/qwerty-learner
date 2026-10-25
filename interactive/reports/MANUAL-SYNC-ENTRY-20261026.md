# Manual Sync UI — implementation and gated validation

Owner instruction: enable PC signed-in account hover dropdown Sync + Account
Management, retain a convenient direct mobile Sync entry. Independent scoped
branch feat/manual-sync-entry-20261026 based on
9457db9572e9561cffb717a7f8d1fb733ba12b65. The separate idle-cleanup
CURRENT_TASK was never modified. No changes to master.

## UI delivered

- PC: signed-in account hover with 170ms dwell/200ms leave, click/touch toggle,
  outside pointer close, Escape, subtle chevron. Entries are immediate Sync and
  Account Management; anonymous login remains the previous direct entry.
- Mobile: 44px one-tap Sync button on home near avatar and study header.
- The mounted UI only pauses/persists Learn data and opens the existing
  `/?s2-sync=run` guarded pre-mount S1 writer-lock/S2 V4 executor in a new
  document. It NEVER imports the S2 execute+CAS while learning is mounted.
- Account-bound, tab-local allowlisted original return path; mobile study return
  deliberately suppresses automatic restart. Suspense timing was reviewed:
  the one-shot marker is removed by the Learn route only AFTER it reads the
  suppression marker, not prematurely by a global notification component.
- The completion notice is quiet and nonmodal. Success is emitted only on
  verified noop/push or on Pull after complete replay of the S2 recovery
  journal. Failed/ambiguous outcomes retain local records and do not claim
  cloud convergence. Last confirmed time is account-scoped.
- No changes to V4 data schemas, FSRS/event merge, checkout handoff protocol,
  cloud backend, or existing CloudSyncSetting advanced actions.

## Real executed checks on exact feature SHA fb20e941ae44654d45ee7085b85067335334ba5f

GitHub Actions runs:
- 40243841615: Manual Sync UI scoped gate SUCCESS. Node mocked guard/intent
  contract 7/7; touched TS/TSX lint passed; yarn build passed; touched-file
  TypeScript clean against repository baseline.
- 40243846101: Learn Block Auto Sync V4 Feature Gate SUCCESS, including
  cloud safety contracts, browser UI E2E, guarded S1/S2 handoff and scoped
  TypeScript regression.
- 40243846098: Performance P0-P1 Branch Gate SUCCESS, including cloud
  contracts, local browser smoke, build and TypeScript regression diff.
- 40243846144: Learn Completion Journey SUCCESS, including final word,
  guarded V4 block sync and five-more continuation.

Historical failures are retained. Earlier self-authored mock test had three
ESLint no-undef references to navigator; corrected with explicit globalThis
in commit291075c. Earlier TS18048 optional-number guards were fixed in
6ed06abc, without relaxing any assertions. The four latest runs above passed.

## Promotion boundaries

Code reviewed and tested on feature branch; integration PR #43 targets
product/main, not master. The user requested implementation rather than
automatic production release. Existing independent main branch changes
(session-handoff deployment policy, idle/release documents) must be preserved
with normal Git merge; never force-push. This report does NOT claim E-test
cloud UI deployment or actual manual V4 upload verification until a deployed
E-test run is separately observed.

Links:
https://github.com/smhe00/qwerty-learner/pull/43
https://github.com/smhe00/qwerty-learner/actions/runs/40243841615
https://github.com/smhe00/qwerty-learner/actions/runs/40243846101
https://github.com/smhe00/qwerty-learner/actions/runs/40243846098
https://github.com/smhe00/qwerty-learner/actions/runs/40243846144
