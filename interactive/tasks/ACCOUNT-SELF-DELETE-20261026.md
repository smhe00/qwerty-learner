# Restore ordinary-user account deletion

Status: REVIEW. Implementation and local validation complete. Report: interactive/reports/ACCOUNT-SELF-DELETE-20261026-report.md.

Owner confirmed: ordinary users can delete their own cloud account; administrators must not be able to delete themselves and must see no deletion entry. Development only; no staging/master promotion or real user deletion.

Base: 651dd04be11157909bc325749b198de47145f0d0. Isolated branch codex/account-self-delete-20261026 in qwerty-account-direct-entry. Separate from concurrent CIRCLE-MINIMAL-UI-20261026; do not change its CURRENT_TASK or source.

Restore desktop/mobile entry in guarded S1 account management. Reuse existing DELETE endpoint and server administrator protection. Require password and explicit irreversible-operation consent; offer portable backup, verify durable local snapshot before cloud deletion, retain original account records in the vault and use existing safe anonymous transition only after a strict success receipt. Persist token-free requested/confirmed state to prevent ambiguous replay across reload. Preserve existing account navigation, password changes, passive return and writer guards.

Validation: browser synthetic normal/admin/permission/error/cancel/unknown/reload/local-failure cases; native/fallback ownership and archived/anonymous records; existing account/password/passive-return checks; relevant backend deletion/admin contracts; scoped lint and Pages build. No live Cloud/Blob evidence claimed.
