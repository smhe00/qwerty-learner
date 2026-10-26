# Account direct entry — development only

## Scope and implementation

User requested one-click login/account management, removing the intermediary overview while preserving safe switching. This task is independent of the active COMMIT-OUTCOME release task; CURRENT_TASK.md and its release authorization were not taken over.

- Initial development base: e4a4e4f93cc83876f72b1cfcd5f29bb62a702f90.
- Integrated base: 521240e4c15f7a8bab460de101ea4f76fd190ef7. Its changes are release test/report updates, unrelated to this runtime change.
- Desktop Header, mobile avatar, and mobile data-page Manage account now use account-navigation.ts.
- Continue using window.location.replace. The old document retains its writer lease until destruction, and the destination uses the unchanged pre-mount S1 ownership guard. No early release/steal, SPA account transition, database-switch or auth transaction changes.
- Normal entry no longer sets the presentation-only s1-reauth=1 flag. Existing destination logic selects anonymous login, valid account management, or expired-session reauthentication. Explicit revocation/reauth links remain unchanged.
- AccountOverview becomes AccountTools, without the login/management intermediary. Its existing administrator panel is retained behind an explicit Cloud Sync > More options > Cloud account tools button, available to authenticated non-expired workspaces. Service-side admin authorization and cleanup confirmation are unchanged.
- The optional tools dialog still runs in the learning document and never switches its workspace. Opening it does not release ownership.
- Tests updated for direct navigation, same-tab/history behavior, current data-route navigation, and Pages base paths. Live Cloud test expectations updated but not executed.

## Validation

Local synthetic/browser evidence, no real accounts or cloud data mutations:

1. NO_PROXY=127.0.0.1,localhost QWERTY_TEST_PORT=4293 node node_modules/@playwright/test/cli.js test --config=tests/e2e/mobile-account.config.ts desktop-account.spec.ts mobile-account.spec.ts mobile-account-writer.spec.ts — **22/22 passed**.
2. NO_PROXY=127.0.0.1,localhost node node_modules/@playwright/test/cli.js test --config=tests/e2e/idle-cleanup.config.ts account-continuity.spec.ts --output=test-results/continuity-final — **14/14 passed**. Desktop/mobile x native/fallback x anonymous/valid/expired; unchanged learning rows, owner, generation, credentials and no pending transition after direct entry/reload/return; a competing tab cannot acquire the writer. Also responsive routing and explicit mobile tools entry.
3. REACT_APP_DEPLOY_ENV=pages VITE_QWERTY_SYNC_DISABLED=true node node_modules/vite/bin/vite.js build — **passed**. Existing Browserslist, Radix directive and chunk-size warnings.
4. NO_PROXY=127.0.0.1,localhost QWERTY_TEST_PORT=4294 node node_modules/@playwright/test/cli.js test --config=tests/e2e/mobile-account-pages.config.ts --output=test-results/pages — **4/4 passed**. Basename, return navigation, disabled auth and no API requests; legacy records and credentials preserved.
5. Extra desktop nested-tools check initially found pointer interception by the settings dialog. AccountTools now uses z-[60] above z-50 settings; --grep 'cloud tools' --output=test-results/tools-final — **2/2 passed**, mobile and desktop including pointer interaction, keyboard focus and close. The final Pages build was repeated for this CSS change.
6. Scoped ESLint on all changed runtime files, focused Prettier check and git diff --check — **passed**.

Initial validation issues were diagnosed rather than bypassed: localhost requests needed NO_PROXY; two concurrent Vite servers contended for the same dependency cache (EPERM and db.export missing), resolved by running the dev-server suites sequentially. A new assertion incorrectly counted the learning app's existing read-only GET /api/auth/me as authentication submission; the corrected test permits only that GET, rejects authentication writes and checks credentials remain byte-identical. No product auth/lock code was modified for these test issues.

## Boundaries and handoff

- No master or edgeone-test push/promotion by this task. Product/main normally triggers cloud-disabled Pages development preview only.
- Not a production, physical-device, Cloud/Blob or release-ready qualification. No real-account testing, live admin cleanup, schema, merge, migration or authentication-policy change.
- The independent-release candidate's frozen UI checker intentionally will not qualify this UI commit. The other release task must continue using its isolated candidate SHA; do not include this change in production without a new release decision and required gates.
- Preserve this direct-entry change when restoring the other task's staged UI, resolving any Header/Mobile/account conflicts by behavior rather than blindly restoring older files.
- Runtime implementation and focused validation are complete: 41 distinct browser cases passed across the recorded runs. Implementation commit is recorded below; delivery targets product/main only.

## Commit checkpoint

- Status: REVIEW (implementation and local checks complete).
- Implementation: 3e869a2d6d92f22f616dbad181a5c5907e399c00.
- Parent/integrated remote development base: 521240e4c15f7a8bab460de101ea4f76fd190ef7, re-fetched after implementation commit and still current.
- Changed runtime files: src/app.tsx; src/components/Header/index.tsx; src/pages/Mobile/index.tsx; src/pages/Mobile/MobileData.tsx; src/sync/account-navigation.ts; src/sync/account-dialog-events.ts; src/sync/CloudSyncSetting.tsx; AccountOverview.tsx renamed to AccountTools.tsx.
- Changed test files: account-continuity, desktop-account, mobile-account, mobile-account-writer, mobile-account-pages, edgeone-s1-cloud-accounts and etest-account-progress under tests/e2e.
- Final build passed in 25.66 seconds; final scoped ESLint exited 0. Local build log is retained in ignored test-results/account-direct-build.log.
- This report is a separate documentation commit after the implementation SHA. Push destination is origin product/main, with normal fast-forward protection.
