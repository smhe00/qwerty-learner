# Account direct entry (development only)

- User authorization: remove the intermediate account overview and directly enter login/account management; retain safe switching; develop only, no release.
- Target: product/main. Execution base: e4a4e4f93cc83876f72b1cfcd5f29bb62a702f90.
- Isolated checkout: qwerty-account-direct-entry. This is a separate UI task, not a takeover of COMMIT-OUTCOME-INDEPENDENT-RELEASE-20261026. Leave its CURRENT_TASK pointer and scope intact.
- Scope: desktop header, mobile avatar/data account button, navigation regression tests.
- Safety: retain location.replace and pre-mount S1 ownership/workspace guards; no early writer release, SPA account switch, auth mutation or cloud-write change.
- Acceptance: one activation opens the correct account surface; logged-in users see management, expired sessions see reauthentication; back/reload and native/fallback writer ownership preserve records. Pages stays cloud-disabled.
- Validation: focused browser account/navigation/writer tests, scoped lint/format and Pages build/preview tests. No real accounts or Cloud/Blob writes.
- Delivery: independent task/report and normal product/main commit/push. No master or edgeone-test promotion.

- Secondary functionality: retain the old administrator/retention tools as an explicit Cloud Sync > More options > Cloud account tools entry; no authentication action in that dialog. The user was asked asynchronously; after no preference was supplied, preserve existing functionality as the conservative default.
- Integration base: 521240e4c15f7a8bab460de101ea4f76fd190ef7 (fast-forwarded during work; only unrelated release tests/report changed).
- Report: interactive/reports/ACCOUNT-DIRECT-ENTRY-20261026-report.md.

## Owner clarification and concurrent release isolation

- Owner clarified: only administrators may see the auxiliary popup; ordinary users must never see it. This supersedes the earlier default of exposing its entry to every authenticated workspace.
- Implementation b89d8a94b957d49705beb2c53a35ce77d897e7b4 gates both the entry and each popup opening on a strict server administrator=true result. Authenticated direct account navigation remains unchanged.
- Main 98697131 temporarily reverted the original direct-entry change for a frozen independent release candidate. Do not undo that isolation while it is under qualification.
- Delivery branch: codex/account-admin-tools-20261026, based on 98697131, with original direct entry restored in 3452f2e8 and the administrator restriction above. Merge after the independent release task permits restoring UI. No master/etest promotion authorized by this task.
