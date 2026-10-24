# Account, progress and dialog continuity

Status: IN_PROGRESS. Base d2306803fd7ee78a53417b71d2655f3dd4e65039.

Root causes: revoked entry does not carry reauth intent; account presentation tests expiry only and hides credentials. Learn sync UI hardcodes light colors. Daily completion requires clean independent eligible review, while the scheduler already reschedules failed eligible reviews; exhausted state still shows add-five. Mobile-to-desktop resize and account inspection use document navigation, reacquiring the unchanged writer lease.

No customer data mutation. Implementation and focused validation pending.


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
