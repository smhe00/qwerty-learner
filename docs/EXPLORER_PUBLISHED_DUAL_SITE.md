# Published dual-site Explorer — Pages vs EdgeOne

## Scope

Production / EdgeOne: https://qwerty-plus.edgeone.dev/ (bound to GitHub `master`; never deploy from this gate).

Development / GitHub Pages: https://smhe00.github.io/qwerty-learner/ (bound to `product/main`, with cloud account/sync UI disabled).

The workflow `Published Dual-Site Explorer (Pages + EdgeOne)` uses *actual published JavaScript*, not a localhost build, and two browser-isolated modes:

1. **Anonymous parity Explorer (12 tests):** six tests per public site: SPA + gallery + FSRS analysis + settings/cloud-feature separation; real Learn keyboard progression for three words with persisted IndexedDB and route round trip; Typing independence; mobile browser shell; two deterministic 14-transition navigation campaigns. Reload/route-corruption regression and page exceptions are also checked. Only safe GET/HEAD/OPTIONS requests are expected; no account creation or cloud writes.
2. **Disposable EdgeOne cloud Explorer:** reuses existing 3-client Playwright E2E with two unique `e2e_mc_*` identities, controlled registration/upload/download/conflict/revocation/restore/isolation, and *mandatory own-credential cleanup* on success or failure. This **does** access production cloud storage, so it runs only for deliberately tagged `[live-cloud-e2e]` commits or explicit manual workflow opt-in. Real accounts are never used. The cleanup result is part of the gate.

## Version and time correctness

Pages browser runs only after the GitHub Pages `source-commit.txt` matches the exact tested commit SHA. EdgeOne is checked by an unauthenticated `/api/health` probe for the live `qwerty-sync-gateway` and `learning-state-backup-v3`, not assumed to have the same commit SHA as Pages. Thus a difference between websites is not automatically a regression; compare only published features shared by the releases.

All anonymous test cases use clean incognito contexts. The browser traces attach only site, route, action, integer cursor and record-count metadata: **never real word spellings, tokens, usernames, passwords, full localStorage or IndexedDB dumps**. Account E2E disables Playwright screenshots, video and trace.

## Coverage evidence / exclusions

- Route refresh and URL growth, lazy gallery and analysis, Settings, anonymous Learn and Typing progress, IndexedDB durability, mobile viewport, daily public health and cloud UI isolation are directly observable.
- Long-horizon 48-hour/Deferred/day-reset verification stays on Pages-only Explorer V3, because production never gets a virtual clock.
- Full FSRS long-term live account campaigns, backup data-loss recovery and simultaneous real users are **not** included in this anonymous suite; these require independent guarded work.
- No EdgeOne Maker build, `master` merge, management API, or change to production code.

Run classification: each real-browser test verdict is binding in this new workflow, unlike existing advisory Pages Explorer. Failing cloud cleanup is a separate failure and must not be conflated with a passed Cloud E2E.
