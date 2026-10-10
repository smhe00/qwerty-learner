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
