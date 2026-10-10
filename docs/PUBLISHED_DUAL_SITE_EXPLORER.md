# Published Dual-Site Explorer: Pages + EdgeOne

## Objective and safe scope

The existing Pages explorer probes multi-day FSRS, Deferred, daily quota and multi-Block learning; EdgeOne's published smoke previously covered only one learned word and URL reload. This adds an identical *cross-environment published-browser* contract. It tests actual served JS, React navigation, real keyboard input, browser-native IndexedDB, and origin-isolated local state.

Endpoints:
- Pages: `https://smhe00.github.io/qwerty-learner/`, pinned to the exact `product/main` SHA via `source-commit.txt`.
- EdgeOne: `https://qwerty-plus.edgeone.dev/`, validated with `GET /api/health`; it intentionally runs the older `master` release. Do **not** compare source SHAs across the distinct deployments.

Both are anonymous, ephemeral Chromium contexts. No account, signup, login, sync upload, deletion or production-cloud mutation. No test-mode time acceleration on EdgeOne. Users' browsers and cloud records are inaccessible and unchanged. Redacted CI artifact contains only route names, word/cursor/record **counts** and error **counts**, never actual words, storage content, tokens, credentials or user identifiers.

## Expanded shared coverage

| Contract | Pages | EdgeOne |
| --- | --- | --- |
| Published origin and service gate | Exact deployed Pages commit | Actual EdgeOne GET health |
| Boot and dictionary | Default 上海中考2027 | Same |
| Settings and backup | Local backup present; cloud section absent | Local backup; cloud/account section present |
| FSRS analysis | Read-only analysis UI loads | Same |
| Learn real keyboard | Two words, actual React keyboard | Same |
| Durable DB | Two Learn wordRecords + cursor survive reload | Same |
| Mode lifecycle | Typing/refresh followed by Learn restores active session | Same |
| Seeded routing | 20 route/reload transitions + 4 stable reload checks | Same |
| Safety | No cloud writes, no JavaScript errors | Same; no test accounts |

Playwright suite: `tests/e2e/published-dual-explorer.spec.ts`.
Standalone workflow: `.github/workflows/published-dual-explorer.yml`, 2 independent matrix jobs and explicit per-site pass/fail. Unlike advisory Explorer inside the Pages deployment workflow, a failing new check fails its own per-site job.

The deeper Pages-only virtual clock remains strictly scoped to the Pages origin. There is **no** virtual clock or browser state fabrication on EdgeOne. For authenticated, multi-device EdgeOne sync write tests, use the existing isolated test-identity and cleanup workflow, not these anonymous tests.

## Reporting and operational rules

This is live published-site regression coverage, not a source-mutation kill score. Distinguish failures due to deployment lag, selectors/UI evolution, genuine persisted-state mismatches, and server errors. Record individual site results and preserve redacted traces for reproduction. Never classify a test harness failure as a product Bug until verified independently.

Deployment policy: modify `product/main` only; `master` is the actual Maker production publishing pointer. No automatic master sync or Maker build is authorized.
