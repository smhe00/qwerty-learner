---
task_id: ACCOUNT-FLOW-POLISH-20261030
status: REVIEW
executor: Codex-account-flow
claim_base_commit: 750e346b3ce58c638f0cf6177a04c58fa0839f7f
integration_base: da0e02f6
implementation_head: 88ce61d361fba8434bdbe9f3a8aa8f15372d98d6
accepted_pages_source: 353117d306ed8fd55a56f6186971c0cd6aacd49a
target_branch: product/main
release_to_master: false
---

# Account flow: one submit, explicit registration choice, original-page return

Owner approved the review of the login journey. Previously login created a server session and then asked for a browser confirmation; cancelling could already invalidate the previous device session. Registration used two native confirms, with the first Cancel meaning an empty new account rather than cancelling registration. Desktop return always went to the default Learn home, losing Typing context.

## Implementation

- Remove post-authentication login confirmation. Existing-account login uses that account's workspace and never imports anonymous history. Registration exposes a labelled, initially checked **带入本机学习记录** checkbox; only registration reads it. Both choices retain the original anonymous workspace. No confirmation dialog follows either submit.
- Keep all real account transitions pre-mount under the existing S1 lease/journal. A bounded, session-only `account-journey` record remembers an allowlisted UI path, never credentials, query strings or recovery/action URLs. Authentication still navigates to the SAME home bootstrap as before. Only after that unchanged bootstrap passes, immediately before app import, does history replace the UI route. Typing/mobile-data returns therefore cannot skip the old V4/M3/M4/recovery sequence. Passive-account-return proof and ownership checks are unchanged.
- Use the shared account visual shell during entry, guarded preparation and return instead of switching between unrelated loading panels. Allow the existing bounded 3-second lease-release wait for desktop account entry/return as well as mobile, without stealing a live lease. Existing occupied/error/recovery gates still apply.
- Expired or explicitly required reauthentication remains available; a healthy account no longer advertises redundant revalidation. Its username is read-only; the returned immutable ID must still match. Known accepted credentials followed by failed workspace preparation hide credential controls and offer **重新检查**, replaying guarded boot rather than submitting another server login. No success is claimed before data readiness.
- Add Escape-to-return only while idle and trap keyboard focus within the account dialog. Busy operations still disable navigation and duplicate submission. Keep both themes, native form validation, password visibility/autofill and account-recovery/retention notices. Compact the mobile shell so even a 320×568 Pages preview has its login CTA fully painted; registration supplementary information follows its primary action.

No backend authentication/session policy, working-workspace transaction, schema, ownership kernel, V4 executor/policy, event merge or learning algorithm changes. No exit-triggered synchronization is introduced. The concurrent visitor-count/Admin update da0e02f6 was integrated intact; its two entry additions do not overlap this task's behavior.

## Validation to date

- Focused Node contracts: **32 passed**, zero failures/skips (account journey, login/startup single-owner contracts, workspace transitions and integrated visitor client/server contracts). Navigation tests reject external/operational/admin destinations, stale metadata and blocked storage, and check both deployment basenames.
- Existing account UI suite: 57 passed initially; the immutable-owner negative-control test attempted to fill the newly read-only username. Updated it to assert the locked username and fill only the password, retaining its forged-server-owner refusal and exact row/auth/owner checks: targeted case PASS (9.7 s). All 58 distinct cases passed, including copy/no-copy registration, zero-request cancellation, one-submit login, offline logout, password changes, self-delete boundaries and native/fallback writer exclusivity. No product source change was made to satisfy that harness correction. This is not represented as an initially clean 58-case run.
- Final integrated EdgeOne production build/CSS ownership PASS (28.98 s / 30.30 s). New production account-flow matrix **12 passed / 44.7 s**, six phone/tablet/desktop + light/dark profiles, no runner retries. Includes exact anonymous data/navigation restoration after login/logout, empty target account on existing login, one server login, no login/register native dialog, original Typing/data route, 100% viewport intersection of the login CTA, rejected local preparation and guarded retry without another authentication request. Private APIs are synthetic, not a deployed real-account certification.
- Pages production preview: the six account-flow profiles passed before final registration layout/integration; final integrated Pages build/CSS PASS (34.99 s / 36.59 s), focused matrix **6 passed / 6 expected real-auth skips (41.0 s)**. Every Pages profile asserts zero API requests, explicit registration selection, original-page return and exact unchanged records/settings. Existing Pages account suite **20 passed / 4 expected desktop-only skips** with zero API requests and legacy data/credentials unchanged; no real login or account creation.
- Scoped source/contract ESLint and whitespace PASS, with three pre-existing index non-null warnings. Whole-tree TypeScript retains the existing unrelated baseline failures; no diagnostics in changed account/index source. Not a passing global typecheck.

## Findings retained without weakening checks

1. Initial production login fixtures were blocked by the real S1 witness: `prepareVisibleUI` rewrote the protected theme on EVERY document load, including after switching to a new account. Corrected the fixture to seed theme only before a migration witness exists, respecting each sealed workspace's settings. Guard code remains unchanged. Initial traces retained under `/tmp/qwerty-account-flow-initial-guard-evidence`.
2. Exact roundtrip comparison initially compared absent navigation defaults with the existing restore adapter's canonical stored defaults. Seeded explicit saved dictionary/chapter/idle-review values under the managed writer, then reloaded to hydrate the fixture before comparison. Final assertions still compare all native table rows and durable navigation byte-for-byte; no tolerance/filter was added. Initial evidence `/tmp/qwerty-account-flow-normalization-evidence`.
3. A new unconditional 100%-visible CTA check caught clipping on short screens, including the Pages explanation. Fixed compact mobile layout/duplicate intro and shortened the explanation while retaining the no-real-password notice. Kept the assertion; primary controls are not force-clicked.
4. Existing `account-continuity.spec.ts` suite: **25 passed / 1 failed**. The desktop nested cloud-tools case times out finding/focusing **预览清理名单**. A fresh targeted run of the unchanged 750e346b baseline fails at the same statement; the changed source does too. It opens no account document and does not execute the new journey/transition UI. Baseline/current logs `/tmp/qwerty-account-flow-baseline-tools.log` and `/tmp/qwerty-account-flow-continuity-desktop.log`; isolated traces `/tmp/qwerty-account-flow-baseline-tools-evidence` and `/tmp/qwerty-account-flow-current-tools-evidence`. No test is removed, skipped or weakened; do not claim the entire legacy S1/GA suite passed. All twelve direct account native/fallback/anonymous/valid/expired continuity cases passed.

Successful final account-flow audits/screenshots are under `test-results/account-flow-edgeone-final`; Pages under `test-results/account-flow-pages-integrated`. Early screenshots/steps were manually reviewed, including narrow light login and dark preparation-error screens. Final source CI must retain its normal per-state reports, screenshots and traces. Local test subprocess outputs now use non-overlapping directories; an early workspace-suite default output directory cleared some unrelated local UI artifacts, so preserved logs and CI artifacts are authoritative where those scratch screenshots are absent.

## Publication / limits

Final local validation complete; source publication and exact-source CI/public Pages regression are next. Main/Pages only. No etest/master ref movement, real user credentials, privileged maintenance or real-cloud account mutations. The ordinary browser inspection session had shown an occupied-workspace guard; no guard/storage clearing was used to inspect around it. Physical phones, OS keyboards and real network timing are untested. Pages demonstrates the presentation with cloud disabled; it does not certify real synchronization.


## Final local checkpoint

Application source frozen after manually reviewing short-screen login, registration and the preparation-error state. The 320×568 primary login action is fully within the painted scroll/viewport intersection, including Pages notice. Registration's action precedes supplementary retention information; the copy choice remains before submission. The error state contains a clear retry rather than disabled, misleading login/exit choices.

Fresh upstream check: da0e02f695c051393559651630e22c719549bfcb. Its visitor client, backend, administrator UI, tests, task/report and CI triggers are all retained. Integration was a clean three-way merge of independent entry additions; no shared source or task was overwritten. Final Node checks include that upstream's visitor contracts. The application/sync/ownership kernels listed above remain byte-identical to that parent. This task deliberately does not fix or suppress the independently failing legacy nested cloud-tool focus case, proved on both unchanged baseline and candidate.

Source publication uses an expected-head lease, never force. The commit introducing this report is discoverable with git log and its Actions/source marker; subsequent public acceptance will be recorded separately. No further application change is planned unless exact-source CI finds a concrete regression.


## Exact-source CI follow-up

Initial source commit c74f8ff581742fd6d7233da0acd9df5f018e7d69 passed its Pages UI job (123988074885) and all twelve EdgeOne account-flow cases. Its overall Pages run 41033335081 did not deploy: 48 administrator recovery fixtures navigated away when the new early progress heading prematurely said “登录 QWERTY Plus”, before guarded workspace initialization finished. Corrected the product caption to “正在打开账号”; only the fully ready form announces the login heading. Administrator test source and every durable-data/authorization assertion remain unchanged. This is a concrete integration defect corrected here, not an independent baseline failure or a suppressed test.

Final review also covered the separate server-revocation reauthentication entry. It now records only the same presentation return context, opens the appropriate desktop/mobile account screen, and returns to Typing/mobile data after the existing home bootstrap. It deliberately does not call beginAccountVisit: a revoked token must never mint the ordinary passive-return proof. No revocation detection, logout transaction, token acceptance, immutable-owner check, V4 startup or sync executor changed.

The existing startup reauthentication tests referenced the removed healthy-account revalidation button. They now assert its absence and enter the explicit required-reauth URL. Both real successful and failed authentication still assert the POST and full-sync meta read; desktop/mobile passive return still asserts zero sync and one-use passive proof. Focused four-case rerun PASS (2.0 minutes), no runner retries.

The real-cloud account test helper now expresses its existing empty-registration choice by unchecking the explicit import checkbox. It expects zero post-submit native dialogs and removes its temporary dialog listener. No real cloud test or user account mutation was performed locally. The revoked-owner fixture asserts the prefilled read-only username rather than editing it. Its return coverage now includes both /typing and /mobile/data. An initial mobile assertion mistakenly looked for the home-only account entry on the data page; corrected to the actual data-page ready marker, retaining exact route, token, owner, pending-journal and offline-record assertions.

Follow-up production EdgeOne build PASS (34.95 s / 36.29 s), CSS ownership PASS; scoped source ESLint PASS. Navigation contract rerun PASS (five cases). Final combined administrator/account production matrix: **120 passed (4.4 minutes)** across all six profiles, zero failures/skips/retries, including all 48 formerly premature administrator recovery cases without editing their tests. Final revoked-session suite: **5 passed (1.0 minute)** including both original-route returns and all unchanged safety assertions, zero failures/skips/retries. The earlier independent nested cloud-tool baseline limitation remains unchanged.

Deployed historical/three-device test helpers also enter explicit required-reauth mode and verify rather than edit an immutable username. Their syntax passes; they were not executed against real accounts locally. Final source diff confirms the bootstrap, account-startup V4, auth transaction, manual V2 executor/policy and M4 witnessed-prefix kernels remain byte-identical to integrated parent da0e02f6.


## Final source CI and upstream integration

Implementation commits: c74f8ff581742fd6d7233da0acd9df5f018e7d69 and 88ce61d361fba8434bdbe9f3a8aa8f15372d98d6. The latter is the final application source for this task.

Exact-source 88ce61d3 CI results:

- S1 Workspace Browser Gate 41035241510: PASS; 155 workspace cases (6.2 minutes), plus three prerequisite cases. This includes the nested cloud-tools case that failed in the unchanged local baseline; its assertions were not weakened. The earlier local failure is retained as local/environment evidence, not represented as a failing final CI gate.
- P4b recovery 41035241622: PASS; 51 cases (2.1 minutes).
- Startup Sync Recovery 41035241551: PASS; 22 cases (2.8 minutes).
- Mobile P0 41035241577: PASS; 97 phone-learning cases, 17 learning/audio cases, all 58 shared account cases in one clean run, and 20 Pages account cases / four expected desktop-only skips.
- Learn Completion Journey 41035241645: PASS.
- Cloud backend job 123994343979: PASS. The enclosing exact-SHA Cloud admission did not qualify this candidate: its Pages run was cancelled when newer main arrived. This does not certify real Cloud/Blob networking or release-ready; no etest/master promotion was performed by this task.

Concurrent upstream 353117d306ed8fd55a56f6186971c0cd6aacd49a changed only the separate ANONYMOUS-UV task/report. It preserves the entire application/test tree from 88ce61d3. Its latest-main Pages run 41035608934 replaces the cancelled 41035241619; no main rollback/freeze was used. Latest-main visible-UI results:

- Pages job 123995973465 PASS: 84 production UI cases /126 expected cloud/admin skips (3.5 minutes); 17 learning/audio cases (28.1 s); 20 Pages account cases /four expected desktop-only skips (39.4 s). Pages keeps its real basename and cloud-disabled build; zero authentication/synchronization requests.
- EdgeOne companion job 123995972975 PASS: 198 production UI cases /12 expected Pages-only skips (6.0 minutes); 17 learning/audio cases (29.2 s). Includes all administrator recovery cases and all twelve account-flow cases, with no retries. The fixture APIs are synthetic.

Public Pages deployment and exact-version browser verification are recorded in the final publication checkpoint below. These are UI/development results; physical device keyboards, real credentials and real-network timing remain untested by this task.


## Final publication checkpoint

[Pages deployment 41035608934](https://github.com/smhe00/qwerty-learner/actions/runs/41035608934) PASS, including both required production UI matrices and deployment job 123999176832. The actual Pages publisher verified source **353117d306ed8fd55a56f6186971c0cd6aacd49a**, artifact **bcdb1eea32213b4a213ae1a564d2a4e1eee7d07d**, actual publisher run 41036841459; public source-marker propagation passed.

The actual public-site Chromium regression then passed **all nine journeys (26.4 seconds), zero retries**: exact source marker, real Learn input/refresh durability, desktop width roundtrip, guide/storage preservation, desktop/mobile local account submission and return, explicit registration copy choice, and original Typing/mobile-data return with zero API requests. [Published preview](https://smhe00.github.io/qwerty-learner/).

Implementation is ready for owner review. This checkpoint only adds this report; application/test source remains the qualified 88ce61d3/353117d3 tree. It is a documentation-only main update, not a new application candidate or an etest/master promotion. Subsequent Pages rebuilding of this report does not erase the historical exact-source acceptance above. This task leaves the independently owned CURRENT_TASK/Circle protocol and the concurrent administrator/visitor task/report intact.

Remaining limits: real login/session takeover/synchronization and Blob networking were not certified on etest by this task; no user credentials were used. The UI fixtures and Pages acceptance do not constitute release-ready or a master release. Whole-repository TypeScript baseline and physical-device coverage limitations remain as recorded above.
