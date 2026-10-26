# Lightweight private feedback
Status: REVIEW. Executor: Codex-lightweight-feedback.
Base: 875c82a2c404b441dc582aa3a018288edeed1f9a.

Owner approved a lightweight feedback center: submitters see their own feedback, administrators reply, anonymous users can continue through a browser-held private credential/recovery link. No public wall, attachments, notifications or learning-sync integration.

Independent task: leave CURRENT_TASK and the Circle executor untouched. Reuse existing verified account/admin authorization and private Blob. PC account menu + settings; mobile menu; shared accessible dialog. Pages must not issue cloud requests. Preserve learning state on open/close.

Acceptance: owner isolation, invalid/revoked credentials, administrator authorization, private guest recovery, bounded input/listing/rate limits, concurrent replies, lost-response idempotency across refresh, deletion scope, PC/mobile UI, no learning sync on feedback navigation. Run scoped checks and push product/main only. No etest/master promotion in this task.

## Owner UI follow-up, 2026-10-26
Status: REVIEW. Base: 33011a55335d123f3094c1ef2f1e11a3d38faa3c. Local validation and development Private Feedback UI CI passed on 7c81e1208b037067eb3a4b61651c8d9bcb4de7da.
Simplify the feedback dialog: one compact toolbar per view; no identity switching. Signed-in visitors always use their account, signed-out visitors use the browser anonymous identity, even when an anonymous recovery URL is opened while signed in. Preserve guest keys and pending sends; no migration. Guard sends against stale login state. Keep private-link recovery as secondary disclosure and remove unrelated controls from composition. Validate account precedence, anonymous recovery, retry/no-sync, PC/320px layout and Pages boundary; development push only.

## PC menu icon alignment, 2026-10-26
Status: REVIEW. Owner requested a missing feedback icon and alignment with preceding account menu items. Base db85edc7; preserved documentation-only main update 77dfe2a7. Added the existing MessageSquare icon at 19px and wrapped the feedback label to match account menu layout. Scoped lint and local browser geometry/click smoke passed; development only.
