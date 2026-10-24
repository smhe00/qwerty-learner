# Mobile menu completion — scoped acceptance

Status: DONE (implementation and scoped mobile UI acceptance). PR #40 targets product/main. This task does not authorize or certify an EdgeOne/master release.

Baseline: dcb11229e06665b7949021c2115112b199b78181. Tested application commit: 2cf88073a9df79a169ed845abe51153a4bdfb86b. This report update changes documentation only.

## Implemented

- Mobile home has five real links and no unavailable placeholders. Existing achievements now open at /mobile/achievements with a mobile back action, including landscape rotation.
- /mobile/history reads only active-workspace raw WordRecords. Date and dictionary filters, daily word detail, attempt/unique-word/explicit-review/day counts and recorded input time are distinct. No mastery inference or guessed missing timing. Empty results differ from read errors; retry and pagination are available. Current dictionary/checkpoint and all six tables remain unchanged while browsing.
- /mobile/data reuses the existing account overview and CloudSyncSetting, including read-only cloud metadata, guarded manual sync, cloud backup/recovery, full local V4 export and file inspection. Import is explicitly replacement, not merge, and goes to the existing independent writer-locked confirmation flow. No direct restore occurs from the mobile page. HTTP cloud-disabled handling and Pages basename are retained.
- Exposure-stage phonetics follow saved UK/US voice. Missing-accent fallback is labeled; hidden recall/spelling probes do not gain an answer hint.
- Settings links to history/data and all three new routes have physical build entry files.

No changes to data schemas, FSRS, account/anonymous ownership, authentication, writer locks, automatic cloud merge algorithms or cloud functions. No real user records/accounts were read or mutated.

## Exact committed-source evidence

Mobile Menu Completion run 40111528629, job 120924087954, source 2cf88073a9df79a169ed845abe51153a4bdfb86b: PASS.
https://github.com/smhe00/qwerty-learner/actions/runs/40111528629

- Scoped source TypeScript audit: PASS. Existing whole-project diagnostics outside the changed UI scope remain; do not claim repository-wide zero errors.
- Scoped ESLint: PASS.
- Production build and physical /mobile/history, /mobile/data, /mobile/achievements entries: PASS.
- 12/12 targeted browser/contract tests: PASS. Includes both account entry paths; previous settings persistence and dictionary checkpoint preservation; calendar and cross-dictionary identities; phone achievements/rotation; history six-table preservation and retry; real gzip export plus valid/invalid inspection; GET-only mocked cloud status; guarded tool navigation; actual UK-to-US settings and exposure display; no placeholders in home.
- 320px dark history and light data screenshots reviewed; no horizontal overflow.

The final workflow validates ordinary committed source with read-only permissions and no credentials retained. Temporary construction scripts were removed.

## Retained failures and corrections

Initial run 40109635899: 10/11 PASS. The failed synthetic phonetic test seeded independent recall, where answer phonetics are correctly hidden. Its trace was retained. Fixture was corrected to exposure and both real UK/US preference changes are tested through router navigation so repeated init scripts cannot mask saved settings.
Construction candidate run 40110410149: scoped types/lint/build and 11/11 PASS. The committed-source run above then added the existing two-entry mobile account regression and passed 12/12. No production data-safety assertion was removed.

## Boundaries

Chromium mobile viewport/touch emulation only; no physical Huawei or iOS certification. Cloud metadata and final transaction handoffs use controlled mocks; these tests do not certify live multi-device cloud convergence or a new destructive restore. No eTest promotion, no master update. Existing website deployment state must be checked separately from this source acceptance.
