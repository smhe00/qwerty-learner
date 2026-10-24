# Account, progress and dialog continuity

Status: IN_PROGRESS. Base d2306803fd7ee78a53417b71d2655f3dd4e65039.

Root causes: revoked entry does not carry reauth intent; account presentation tests expiry only and hides credentials. Learn sync UI hardcodes light colors. Daily completion requires clean independent eligible review, while the scheduler already reschedules failed eligible reviews; exhausted state still shows add-five. Mobile-to-desktop resize and account inspection use document navigation, reacquiring the unchanged writer lease.

No customer data mutation. Implementation and focused validation completed; release gates in progress.


## Implementation and focused evidence

- Daily formal eligible reviews count toward today's work even for an honest Again outcome. Independent clean recall remains separate; practice, reinforcement, old-day and unsupported legacy-mobile positive evidence do not manufacture mastery. Acquisition admission and FSRS/history/snapshot guards unchanged. Extra rounds require fresh review attempts.
- Read-only replay of the supplied incident: completed116/116, review96/96, independent review67, consolidation29, new20/20, remaining0. The source file and all user records remain unchanged; no private raw data is committed.
- Revoked notice carries explicit reauth presentation intent. Credentials are immediately visible, same-owner S1 transaction remains mandatory.
- Ordinary account inspection is an in-document dialog, pauses active typing and retains input/lease. Responsive menu-to-desktop navigation uses the existing router. Actual identity changes still require pre-mount safety.
- Pre-mount startup/sync/account dialogs and informational results use compact themed surfaces. Routine successful sign-in is quiet; actionable retained sync notices remain visible. Diagnostic bundle gains numeric daily-completion/recall counts.
- Local daily-session unit suite14/14 PASS; original immutable-row checks and extra-round freshness assertion included.
- Revoked same-account browser reauth1/1 PASS, including unchanged original offline record and active owner.
- No-op account+responsive browser contract1/1 PASS: same performance.timeOrigin, exact original rows and unchanged owner/generation, no pending journal. Initial cold lazy-route default5s wait was raised to30s; test then found and verified a real Escape-close fix.
- Sync dialog browser suite5/5 PASS: pending actions locked, success/failure paths, saved light/dark themes and bounded card dimensions.
- Production bundle build PASS. Scoped ESLint has zero errors and five style warnings. Additional account presentation checks found footer alignment and a dialog root briefly measuring zero size at first entry. The captured close stack identifies Headless UI ResizeObserver, not lost input or outside click. Footer is now inside the card; dialog root has fixed viewport bounds and is outside route Suspense, retaining shared state. Targeted rerun PASS. Native login-form error/keyboard/theme/centering check also PASS.

## Release checkpoint

Main commit, exact etest source/gates, focused live disposable-account test and production promotion pending. Required gates remain unchanged. No production regression accounts will be created by this task.

- Existing Learn persisted-statistics/reload browser scenario1/1 PASS. Opening, registration tab policy and return path1/1 PASS after the actual ResizeObserver fix. Debug instrumentation removed.

## Exact etest result and CI follow-up

Main e4d51b71b1a67b1e1c25c7990deebbd2331139b5 was promoted to etest after main push. Published t.smhe.cn marker e4d51b7 confirmed. Dedicated live browser acceptance PASS 1/1: 2/2 formal review tasks, 1 independent pass / 1 consolidation, no-op account + resize same document, revoked same-owner reauth without logout, exact original rows retained, dark account dialog, disposable-account deletion verified.

CI found outdated test expectations: login-event-warning required an unconditional login-success message despite quiet success; Learn strip required five instead of six cells. Assertions updated to explicit quiet success and six distinct labels; retained invalid history/uncertain write/M4 diagnostic and unchanged-row assertions. Frozen mutation locators drifted: two daily-session expressions changed only by formatting; the pre-existing initial-due locator predates the terminal-probe branch. Locator-only maintenance retains the identical missing-carryover, omitted-review-target and doubled ordinary initial delay faults, all original mutant IDs and detectors. No survivor, threshold, assertion or mutant was removed. Original e4 invalid results remain recorded rather than presented as passes. Published Dual-Site Explorer's old EdgeOne alias expects removed mobile explanatory text; that unrelated alias failure is not used as canonical production qualification.

Follow-up local checks: login-event-warning 9/9 PASS with original history and M3/M4 safety assertions; six-metric browser1/1 PASS; phone explicit login/back1/1 PASS; avatar/menu single-tab policy2/2 PASS (the click observer now sits at React root, where propagation is intentionally stopped; overview keeps history/timeOrigin, explicit login adds one history entry). Both frozen mutation suites execute all16 mutants and reject all16, invalid0, with unchanged detectors. Existing CI additionally passed S1 Workspace Browser Gate, Learn Real Journey, P4b Recovery, Architecture, Toolbar, Achievement, M3 Relay and Safe V4 Merge Writeback. Initial e4 three-device fork failed on explicit login HTTP500; cleanup200. Original Branch Cloud test passed3/4 and Blob transport/cleanup but its phone entry still expected immediate full navigation; adjusted to verify overview then explicit login.

A final Pages-only path review found the account overview inspected the raw `/qwerty-learner/mobile` pathname as though it had no basename. It now uses React Router's normalized pathname, keeping phone account navigation on the phone preview. Production/root-host behavior is unchanged. Pages build and the specific published-layout phone-account preview test PASS1/1, including cloud-disabled/no-API assertions.

Native-modal CI adaptation: 843cc887 Cloud browser4/4 passed; its transport upload/readback passed but test-account deletion returned HTTP500. The three-device test reached a restored application with an informational modal and could not query the inert settings button. The test now acknowledges only `dialog.safety-information-dialog` via its real Know button after proving the app DOM mounted; recovery, ownership, convergence and raw-row assertions remain unchanged. The historical helper uses the same interaction. Initial e4 historical run hit its10-minute timeout without a cleanup proof; do not claim that account was deleted. 53076425 M3 relay functional assertions passed but cleanup returned account_delete_unavailable; cleanup remains unverified. These staging-only cleanup limitations do not authorize any customer-account deletion.

Final-source local P4b lost-commit-ack case PASS1/1 unchanged, after CI48/49 with a transient fingerprint mismatch; original failure retained. Source and full-V4 safety guards were not changed to pass the test.
