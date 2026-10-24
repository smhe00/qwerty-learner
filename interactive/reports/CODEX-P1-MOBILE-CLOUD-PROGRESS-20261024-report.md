# Mobile cloud progress investigation

Status: PARTIAL; no customer data or production code changed. Base product/main c088a1f6738fe83406a8003ce2af4f85ce3cf318. Source/deployment cfeaef6a1769bbaf94c9ed8ccd147727a058ad2f.

## Confirmed source and deployment

`src/sync/learning-sync-policy.ts` permits only exact HTTPS origins, including https://q.smhe.cn. Pages and VITE_QWERTY_SYNC_DISABLED disable synchronization. `account-startup-v4.ts` includes /mobile and /mobile/study (query-free ordinary entries). No phone user-agent/viewport disable branch exists. Full V4 restores navigation, daily sessions and all six data tables; M4 event-only convergence deliberately preserves local navigation and daily sessions. Mobile daily view depends on the current dictionary and current-day frozen session. Without that session, its new preview starts at now and does not count previously received attempts as work after the preview start. This is a separate presentation/session-reconstruction candidate, NOT confirmed attribution of this incident.

Production root, /mobile and /mobile/ all return HTTP200 with identical app-e88f9f4c assets; source-commit.txt reports cfeaef6. Read-only HTTP check confirms http://q.smhe.cn/mobile ALSO returns200, remains HTTP, and supplies no HSTS header. The source's exact HTTPS admission therefore disables S2/M3/M4 on this otherwise loadable origin. Awaiting the owner's actual phone protocol before attributing the report. Do not relax the HTTPS allowlist or redirect an existing HTTP learning workspace without a deliberate preservation path: HTTP/HTTPS local storage are separate.

## One targeted real etest check

Added manual `tests/e2e/etest-mobile-cloud.spec.ts` and config. Runtime 47.5 seconds, one test PASS against deployed cfeaef6. Fresh desktop and mobile-emulation browser profiles, no existing user profile. One uniquely created disposable etest account. A known synthetic desktop daily review record and CET-4 selection are uploaded by the shipped S2 startup path; an empty phone logs in through /mobile/account, requests200 metadata/manifest/part, restores exact raw rows/navigation/frozen daily session and renders1/2 completed. This is Chromium mobile emulation, NOT physical phone/browser certification. Production was read only.

The test's output proof is adjacent. Account cleanup200/accountDeleted=true verified, no credentials or private data retained. Diagnostic extraction accidentally JSON-parsed a plain startup status string, yielding null in the initial proof; the helper now reads that string directly. This affects only supplemental diagnostics, not the successful transport/raw-data/UI assertions. No repeat live account test merely for this output correction.

## Next

Confirm whether the user's phone is on HTTP or HTTPS. HTTP requires a safe secure-origin entry/migration design; do not transfer bearer tokens through URLs or erase the old origin. If HTTPS, request/export the phone's redacted sync diagnostics and check actual owner, V4 result, event adoption and daily-session presence before changing merge rules. Existing mobile-entry tests alone could not prove download; the new targeted test closes that acceptance gap. No promotion required for this tests/report-only investigation.

Scoped test formatting and ESLint with explicit TypeScript/module parser pass. The repository default ESLint overrides do not include tests/e2e (initial default invocation reports module parse errors); no lint configuration was weakened. Main was re-fetched and remained at the recorded base before committing this tests/report-only checkpoint.
