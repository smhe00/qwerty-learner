# Ordinary-user self-service account deletion

Status: implementation complete, final integration checks in progress.
Base: 651dd04be11157909bc325749b198de47145f0d0. Separate task from the active Circle UI; its CURRENT_TASK and implementation remain untouched.

## Cause and behavior

The old self-deletion form was removed from CloudSyncSetting by 9450c326 when account actions moved to S1. No replacement was added to the guarded account view. The server DELETE /api/auth/account and administrator_protected rejection still exist; PR #45 did not cause this omission.

Both desktop and mobile account management now show a collapsed Delete my cloud account action only after a valid matching session receives strict administrator === false. Administrators, anonymous/expired sessions, unavailable/malformed permission results and cloud-disabled Pages have no deletion entry. Permissions are checked again at submission; existing server administrator rejection is unchanged.

The form offers a portable V4 backup, requires current password, explicit acknowledgement and final confirmation. Under the existing pre-mount exclusive writer lease, it verifies owner/generation/witness and captures, stores, reloads and fingerprints the current local snapshot before any DELETE. Only a strict ok=true/accountDeleted=true receipt authorizes the existing safe transition to anonymous. The original account snapshot and anonymous workspace remain separate; the UI discloses that deleted-account records are not automatically copied into the anonymous workspace and recommends saving a portable backup for future recovery.

A token-free, immutable-account-scoped local operation record is written before DELETE. Network errors, unknown 5xx, malformed or incomplete success receipts cannot clear it or authorize another DELETE, including after reload. Confirmed receipts persist so a failed local exit can be completed without a second DELETE. Explicit password/auth/admin rejection permits input correction; an unknown/partial deletion is never labelled successful. Existing narrowly authenticated safe request-body retry policy is reused unchanged. No password/token is added to the operation record.

No backend, workspace schema, auth transaction, sync, lease or administrator policy change. The passive-return shortcut is invalidated when a deletion is actually submitted, while ordinary account visits remain passive.

## Validation so far

- New self-deletion suite 24/24 and existing password/login suite 6/6 PASS (30 total, 59.5 seconds). Synthetic APIs only. Includes PC/mobile, native/fallback locks, download and exact archived/anonymous data comparison, admin/failed/malformed/expired/anonymous visibility, cancel/password error, four ambiguous outcomes across reload, fresh admin promotion rejection, backup/journal/exit failures, and confirmed-exit recovery.
- Existing account-continuity 26/26 PASS (1.7 minutes): direct navigation, settings/admin menu, original records, history, mobile/desktop and native/fallback ownership.
- Relevant server contracts 3/3 PASS: password-required deletion, environment-managed admin rejection and reserved admin registration protection. Command: node --test --test-name-pattern='account deletion|administrator uses|SMHE.*registration|administrator.*register|registered.*administrator' tests/cloud/backend-core.test.mjs tests/cloud/idle-accounts.test.mjs.
- Scoped runtime ESLint, formatting and diff checks PASS. Pages-mode build PASS in 51.02 seconds (ignored test-results/account-self-delete-build.log), with existing dependency/chunk warnings.
- Full tsc reports 147 diagnostics in other files; none in account-self-delete.ts or workspace-account-ui.ts. This is not a globally clean typecheck claim; raw ignored log: test-results/account-self-delete-types.log.
- Initial synthetic fixture performed a workspace switch and reseeded before entering the guarded page; initialization stalled before loading the new UI. Replaced with the established direct workspace initialization fixture and separately saved/distinct anonymous records. Production guards were not changed or bypassed; the real deletion exit still uses the actual workspace transaction and all ownership/data assertions remain.

Additional duplicate-submit, narrow/dark-layout, passive-return and integration checks are recorded below when complete. No real user/account deletion, Cloud/Blob validation or production/staging promotion.
