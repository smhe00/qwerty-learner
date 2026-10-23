---
protocol_version: "1.1"
task_id: "TASK-20261023-desktop-shared-account-ui"
status: "REVIEW"
target_branch: "product/main"
base_commit: "eb40fd6a"
executor: "Codex"
report_file: "interactive/reports/TASK-20261023-desktop-shared-account-ui-report.md"
release_to_master: false
---

# Share the phone account interface with PC

User explicitly requests PC login use the more reasonable phone login interface. Reuse its native login/register tabs, labelled fields, password visibility, friendly errors, account state and safe logout. Desktop centered card and keyboard focus; preserve phone layout. Keep pre-mount writer lease, anonymous/account isolation, auth transitions, same-account reauth and Pages read-only previews. Update corresponding UI test interactions without weakening persisted-data assertions. Current independent cloud CURRENT_TASK not claimed. Active staging is https://t.smhe.cn/; do not deploy production. Stage only after identical-SHA Cloud/Pages/admission and shared-account browser gates. Use isolated staging UI verification without real-user credentials or fixture creation.


## Additional user scope

Registration must show no account recovery/password reset and a six-month unused-account deletion policy. User subsequently authorized a simple password-change UI using the existing backend, and explicitly deferred any six-month cleanup implementation. Therefore register copy now states that signed-in users can change passwords, recovery/reset is unavailable, and accounts unused beyond six months will be deleted. This is requested policy copy only: no inactivity timestamp, scheduled cleanup or account deletion is implemented or activated by this task. UI uses current-password authentication and the returned session token, with same-owner S1 reauthentication. No production release or real-user credential changes.

User also explicitly requests different missing-account and wrong-password login hints. Backend login now returns `account_not_found` / `incorrect_password` (HTTP 401), frontend shows separate Chinese hints, and current-password verification retains its previous error. No account lookup endpoint or data write on failed login is added.
