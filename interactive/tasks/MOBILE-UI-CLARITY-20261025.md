---
task_id: MOBILE-UI-CLARITY-20261025
status: IN_PROGRESS
executor: Codex (independent presentation task)
target_branch: product/main
base_commit: a782fb0e46c361bff1eca5ffaef2aee15fe8d18a
release_to_master: false
---

Owner requests concise mobile login/account UI from the user's perspective, removing public SMHE/administrator explanations and engineering language. Audit login/register, account overview, sync/backup and history screens. Keep meaningful data-loss disclosures, existing auth/ownership/lock/recovery/backup/maintenance APIs and all permissions unchanged. Do not activate idle cleanup. Preserve the blocked activation CURRENT_TASK pointer/report; this is an independent user-authorized presentation task, not a replacement executor for activation.

Implement brief default copy and progressive disclosure. Verify relevant mobile form interaction, normal-user/admin visibility, unchanged backup records and mobile layout using isolated local fixtures. No real accounts or broad cloud regression. Commit/push main only, no release in this UI request.
