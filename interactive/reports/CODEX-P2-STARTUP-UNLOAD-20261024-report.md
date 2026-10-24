# Startup unload warning repair

Status REVIEW. Base d218a839. User confirms actual cloud-sync functionality passes.

Confirmed from the public production asset: app-307941f7.js function Rt acquires the IDB writer lease then calls window.addEventListener("unload", cleanup). Source: src/sync/workspace-lock.ts:188 at base. q.smhe.cn/learn has no Permissions-Policy response header. Chrome's current official deprecation documentation explains the browser default; this is not a domain gate or new cloud failure. The rejected handler only releases lease resources and never touches learning rows.

Plan: remove deprecated unload listeners, retaining explicit release, native lifetime locks, transactional IDB ownership, renewal/expiry and focus/visibility checks. No unsafe pagehide replacement. Focused validation only, per owner instruction. Prior sync release evidence remains on codex/v4-session-report-20261024 (44cfa543).

References: https://developer.chrome.com/docs/web-platform/deprecating-unload and https://www.w3.org/TR/web-locks/ .

## Result

Removed exactly three unload add/remove listener statements, retaining explicit release and all election/renewal/loss handling. The browser-denied registration is gone. No pagehide release, browser-policy opt-in, database migration, cloud write or dependency change was added.

Validation is intentionally focused under the owner's small-change instruction:

- RED: under the real Permissions-Policy unload=() response, the original lease implementation produces exactly the reported console violation, including after refresh.
- GREEN: 7 affected-boundary checks passed: no unload violation across refresh; live fallback exclusion; copied-tab rejection; native/fallback common election; cached pagehide retains ownership and native close permits successor; a native tab cannot preempt a closed fallback before its actual 15-second lease expiry; same-tab fallback refresh reacquires without unload or explicit release and preserves the synthetic learning row.
- Scoped ESLint for src/sync/workspace-lock.ts passed; diff whitespace check passed. No full Cloud/workspace regression, build matrix or live cloud account tests were run for this maintenance.
- An existing full application UI refresh test timed out waiting for its settings button. The exact unchanged d218a839 source reproduced the same failure at the same assertion. A trace showed the pre-mount ownership screen; this is recorded as an unresolved local baseline/startup issue, not declared passing and not attributed to this listener removal. Its assertions remain unchanged. The directly affected fallback reload behavior is independently proven through the real lease harness.
- The first draft policy reproduction used the whole application and hit that UI timeout; the final focused reproduction targets the real lease entry directly. No retry or larger timeout was added to obtain a green result.

Compatibility limit: a different tab replacing a closed fallback-only holder may wait up to the existing 15-second lease TTL. Same-tab refresh and native-to-native close are tested separately. Explicit release remains available for controlled handoffs. The simulated cached pagehide test proves no premature release; it does not claim a physical-device BFCache certification.

AGENTS.md now records risk-proportionate validation, no duplicate broad local runs, no blanket CI skip, and batching small console maintenance into a future authorized release. Existing GitHub workflow configuration is unchanged; this task does not trigger etest/master. Production remains d218a839. Prior completed sync evidence is retained on codex/v4-session-report-20261024 at 44cfa543.
