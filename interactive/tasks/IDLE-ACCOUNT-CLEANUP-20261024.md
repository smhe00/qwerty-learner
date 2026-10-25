---
task_id: IDLE-ACCOUNT-CLEANUP-20261024
status: IN_PROGRESS
target_branch: product/main
release_to_master: false
---
# Idle account cleanup and SMHE administrator

Owner explicitly requests implementing idle cleanup separately; Circle UI work is paused.
Continuous 180-day inactivity deletes cloud account and cloud learning data; No extra 30-day grace period; state the retention policy at registration/account inspection. Successful login/authenticated cloud access restarts inactivity. Browser learning records are never deleted. SMHE is the designated administrator; bind to immutable user ID, exempt from automatic deletion, never grant by client username.

Base: 5cd49872e6f2a6389c0de6eebdf03725c9a7e115. Single executor Codex.

SMHE password uses server ADMIN_PASSWORD when nonempty, otherwise the owner explicitly requested fixed default 98765432; configured values completely disable that default. Fixed-default source code is explicitly authorized by this owner instruction; never commit an actual configured runtime secret. app password changes are denied and rotation invalidates old admin sessions without persisting the environment password or verifier.

Scope: activity tracking, conservative legacy grace, administrator preview/control UI, activity-triggered daily resumable cleanup, backend authorization and deletion fencing, policy notice, focused safety tests and operational documentation. Existing Circle data holds remain enforced; no Circle development or automatic social-data scrub. No real account deletions, etest/master promotion or enabling production automation in this development task.

Acceptance: default-off destructive execution; explicit immutable administrator binding; ordinary/revoked users rejected; dry run has no writes; old accounts receive full 180 days; recent activity and admin exempt; in-flight requests drain before deletion; failure resumable without prematurely deleting identity; exact namespaces only; Circle holds fail closed; local records untouched; no external scheduler is used. Login finishes and the app mounts before a separate maintenance HTTP request; maintenance errors never block or revoke foreground login/learning. Persist a daily gate and scan cursor; permit interrupted deletion to resume next day.

Validation: focused lifecycle/Blob/core/route tests, frontend lint/types/build as appropriate. Report exact outcomes and required deployment configuration; commit/push product/main without force. Release requires separate owner authorization under AGENTS.md.

Owner amendment: missing/empty ADMIN_PASSWORD uses the explicitly supplied fixed bootstrap default. No automatic administrator-ID inference, account creation, database-password fallback or cleanup exemption changes.
