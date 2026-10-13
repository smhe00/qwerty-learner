# M1 independent device sessions — development checkpoint

**Status**: PARTIAL — code landed in \`product/main\`, no live multi-device pilot/release.

## Base and first commit
- Started from \`a615895bcd8c29dab8d1fa966d61fcbf04a35442\`.
- Implementation commit: \`25e80ebb0a5bd1855377197f4d35b6ee05b2f64c\`.
- Cloud Sync Gate [#38386607197](https://github.com/smhe00/qwerty-learner/actions/runs/38386607197): **SUCCESS**, node backend contract tests, cloud/frontend lint and build all passed.
- Second commit: add explicit fail-closed V4 write guard in M1 pilot, extra test and this checkpoint. Exact commit SHA is GitHub branch commit following first SHA; use branch history to confirm.
- \`master\` unchanged.

## Tested locally in GitHub Actions
Default single-session; two independent concurrent logins and simultaneous valid tokens; per-token revocation; account-wide password change; account deletion/username reuse; legacy session conversion/rollback; blocked V4 upload when pilot enabled.

## Not yet demonstrated
No real EdgeOne multi-region consistency, user-facing pilot or independently authenticated dual-Chromium Maker run. Account auth-version latest-read eventual consistency and retention garbage collection remain risks. Formal M2 replay and M3 append-only cloud publication remain unimplemented.

## Current project task coordination
\`interactive/CURRENT_TASK.md\` still points to TASK-20261011-014 forced session revocation IN_PROGRESS. This work does not close or silently reassign that preexisting P0. Before executor handoff, explicitly coordinate/reconcile these tasks.


## Continuation checkpoint — 2026-10-13

- M2.1 read-only foreign-key rewrite implementation: \`22ffdcfcc2591e8495314b7fd0581683d655cc81\`; ESLint-only fix: \`50c7e4960e821c2edac42bbc010dd5aec8ffc941\`.
- M3.0 additive event-batch publication pilot implemented under separate OFF-by-default flag; inspect commit history after \`50c7e49\`.
- Full convergence and Maker qualification are not claimed. No production release authorized.


## Continuation verified — code through \`baab28891eb9043e06ed91ba71197fa693407ce9\`

- M2.1 read-only cross-device foreign-key mapping: \`22ffdcfcc2591e8495314b7fd0581683d655cc81\`, lint fix \`50c7e4960e821c2edac42bbc010dd5aec8ffc941\`. Re-maps word numeric keys, chapter link lists and achievement event/state provenance without mutating either source. Preserves ambiguously shared chapter rows rather than silently deduplicating; **not publishable**.
- M3.0 opt-in immutable event-batch POST and exact receipt GET: \`aa93962a21752b97745b99a8469d11ffcfe211e5\`, syntax fix \`1a89ed60ff4d6fbb87aea0ee511f7866d8b1ba25\`.
- M3.1 nonauthoritative receipt observations and stale-list conflict simulation: \`baab28891eb9043e06ed91ba71197fa693407ce9\`.
- **Cloud Sync Gate [38415704806](https://github.com/smhe00/qwerty-learner/actions/runs/38415704806) = SUCCESS.** Backend contract tests, cloud JS lint, sync TS lint, and Vite build all PASS.
- Previous standalone S1 Browser Gate [38387618206](https://github.com/smhe00/qwerty-learner/actions/runs/38387618206) = SUCCESS, P4b Chromium [38387618201](https://github.com/smhe00/qwerty-learner/actions/runs/38387618201) = SUCCESS; these preceded the M3 changes, so they do **not** certify M3 live behavior.
- No active runtime auto-merge or Block event upload is wired. \`MULTI_DEVICE_AUTH_ENABLED\` and \`MULTI_DEVICE_EVENT_PILOT_ENABLED\` remain default OFF. When multi-session auth is ON, legacy V4 snapshot writes remain fail-closed.
- GitHub Pages workflow previously failed on its published Learn real-typing regression, not the new cloud contract. This remains an independent regression / site-deployment issue; do not declare Pages healthy solely from Cloud Sync Gate.

### Next required actions
1. M2.2 give chapter/session records stable cross-device identities, rebuild both durable FSRS and achievement provenance from canonical attempts; adjudicate lifecycle/current-session control state without double counting.
2. M3.2 add a durable per-device receipt/watermark or another formally verifiable discovery protocol that tolerates EdgeOne Blob list eventual consistency. Never equate a list snapshot with global completeness.
3. M4 fault-test no-CAS parallel publication, offline retry, duplicate and contradictory attempts, account-scoped revocation, reset and deletion races; run genuine independent-browser-profile Maker tests with disposable accounts.
4. Keep \`master\` unchanged until those release gates succeed.
