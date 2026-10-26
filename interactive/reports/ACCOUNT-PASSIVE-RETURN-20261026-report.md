# Account passive return report

Status: IN_PROGRESS. Isolated worktree qwerty-account-passive-return, base95184f9f. Previous unified release cbb20842 preserved; PR45 administrator UI kept. Root cause: account return uses location.replace to a normal learning route, so guarded boot reruns V4 and M3/M4 and the background pump starts a new2s initial scan. Implement one-shot guarded navigation intent, retain all safety recovery, avoid immediate background scan on this specific return. No cloud backend change planned.

## Implementation and local evidence

- Added a five-minute, single-use, tab-local passive account visit ticket bound to the existing account, registry generation and integrity witness. No credentials are stored in the ticket. Returning consumes it before journal recovery. Every S1/S2/manual/M4 recovery branch, final journal/owner/witness check and session-revocation check remains active.
- Any authentication action invalidates the passive visit, including failed authentication. Unknown/pending startup outcomes do not enable the optimization. Explicit quick-sync intents, changed owner/witness/generation, expired/future-clock/malformed markers and reloads use normal startup.
- A passive return resumes the existing 45-second background cadence instead of starting a new two-second scan. Online/visible wakeups and subsequent periodic repair remain unchanged.
- Local cloud contracts: 880/880 PASS, including 35 focused startup/drain contracts.
- Local Chromium: 10/10 PASS (PC/mobile actual UI passive returns, successful/failed reauthentication, slow/offline/lost-ACK, real S2/M4 journal recovery, six-table union). After adding a valid passive marker to both real journal cases, those 2/2 passed again. Synthetic cloud only, not live deployment proof.
- Source ESLint: zero errors, three existing index.tsx non-null warnings. Default ESLint does not parse tests/e2e TS files (existing configuration); actual Playwright compilation/execution passed. Whole-repo tsc remains non-green with pre-existing diagnostics; none reported in changed source paths. Do not report whole-repo typecheck PASS.
- Added deployed real-account PC/mobile passive-return assertions to the existing etest Cloud E2E job, using only its disposable fixture. Pending execution on the candidate SHA.
- Before commit, upstream advanced to a11362de (PR46 architecture/persistence remediation). Fast-forwarded the isolated checkout; no overlapping source changes. All upstream UI, administrator tools and persistence changes are preserved. Architecture boundaries pass. Same-SHA CI will validate the integrated candidate; no old SHA evidence may satisfy release gates.

## Remaining release gates

Commit/push product/main; require candidate source CI, published Pages, etest actual source SHA, real Cloud/Blob/browser (including passive return), hard three-device 3/3, and release-ready. Only then fast-forward master to the exact tested SHA. Verify q.smhe.cn source and production test-feature policy. No master or etest push has occurred in this task yet. Keep historical unrelated cleanup ambiguity in its prior report; never replay unknown writes.
