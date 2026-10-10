# P0 Remote session takeover and safe anonymous switch — implementation report

## Baseline

Backend single-session enforcement was already present: login issues a newer session, `/api/auth/me` rejects the older token with `401 session_revoked`. Real Maker API acceptance run [38085108313](https://github.com/smhe00/qwerty-learner/actions/runs/38085108313) verified token revocation. UI detection/alert and local workspace handoff were absent.

## Implemented (DEV product/main only, NOT YET published)

- `src/sync/api.ts`: when the request returns `401 session_revoked`, emits `qwerty:cloud-session-revoked` only if its token is still the **same** currently stored credential. Never publishes a token in DOM event detail.
- `src/sync/session-revocation.ts`: S1 isolated-account monitor checks `GET /api/auth/me` immediately, every 30 seconds, on focus/visibility regain (throttled); handles any current-token revoked API event. Explicitly ignores offline/503/429 and `session_expired`; suspends probes after revocation. Accessible overlay requires human confirmation.
- Confirmation commits a per-tab intent containing immutable accountId + S1 registry generation and navigates to `/?s1-session-revoked=confirm`, **without** directly modifying local credentials or running a mounted-app DB transition.
- `src/index.tsx`: new pre-mount route runs inside the existing S1 exclusive-writer lease; validates the explicit handoff against current accountId + generation; runs the durable `switchAuthenticatedWorkspace(account→anonymous, auth=null)` transaction; reloads into fresh anonymous realm. The original account V4 snapshot is retained in Vault, with no automatic upload/merge.
- Crash replay / duplicate completion is constrained by a validated S1 generation increment; unrelated anonymous registries are not accepted as completed forced exits.
- New Playwright `tests/e2e/workspace-v4-session-revoked.spec.ts`: distinct Chromium BrowserContexts with simulated login B superseding session A, explicit modal, confirmed safe S1 switch with retained word row, surviving B session; offline 503 and normal session expiration do not show takeover alert; no confirmed handoff denies logout.

## Validation status

- An intermediate Playwright run [38087688337](https://github.com/smhe00/qwerty-learner/actions/runs/38087688337) printed **16/16 pass**, including three new scenarios, but its GitHub Job was cancelled during further follow-up commits; this is implementation evidence, **not** the final workflow Gate.
- Latest scoped CI candidate and final Cloud Sync + browser job conclusions must be checked separately before enabling a public Maker build.
- Production `master` remains `7818e2a` strict allowlist. The forced logout UI is **not** yet in production.

## Remaining P0 acceptance

- [ ] Latest Cloud Sync Gate full completion: lint, build, backend tests.
- [ ] Latest Chromium browser Gate full completion, including all three new takeovers.
- [ ] S1 complete browser + Learn Real Journey regression after change.
- [ ] Fault injection at transaction steps and stronger cached-session false-revocation / timed network behavior.
- [ ] Disposable Maker account A/B real-site test, then controlled release if all Gates pass.
- [ ] Distinguish users still in V1 legacy mode from those who have migrated to S1; this handler presently targets **isolated account workspaces**, not a blanket V1 legacy login workflow.

Status: IN_PROGRESS. Do not mark done solely because the new code was committed.


## Latest completed development Gates — PASS

- Final code candidate `cd82564250fe4f864f92f37f4ba13f02f83af5db`.
- Cloud Sync Gate [Actions #38087949862](https://github.com/smhe00/qwerty-learner/actions/runs/38087949862): **SUCCESS**, backend tests PASS, frontend/cloud lint PASS, Vite build PASS. An earlier attempt [#38087865196](https://github.com/smhe00/qwerty-learner/actions/runs/38087865196) found four new ESLint errors; all were fixed (import sorting, two empty callbacks, prefer-const) without weakening behavior.
- Chromium Gate [Actions #38087949894](https://github.com/smhe00/qwerty-learner/actions/runs/38087949894): **SUCCESS, 16/16 PASS**. All 13 original S2 recovery cases and three new session-takeover tests passed:
  1. Two independent profiles: B logs in and supersedes A; A detects 401, user confirms, S1 pre-mount transaction switches to anonymous while original account V4 word row remains in Vault; B keeps current token.
  2. Real 503 response and ordinary `session_expired` do not force a takeover dialog, and owner/data remain intact.
  3. Visiting pre-mount forced-logout URL without a confirmed handoff cannot change account ownership.
- All observations are from real Chromium against Vite with deterministic mocked `/api/auth/me`, **not** the public Maker user journey.
- `master` remains unchanged; do not label this feature production-ready until the existing legacy V1 / new S1 migration path and actual Maker authentication journey are qualified.
