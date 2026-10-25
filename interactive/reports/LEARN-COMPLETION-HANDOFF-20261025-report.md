---
task_id: LEARN-COMPLETION-HANDOFF-20261025
status: REVIEW
executor: Codex
target_branch: product/main
claim_base_commit: 279bd3bc1ff99c548ca515ebc373d3146db94f3b
release_to_master: false
---

# PC last-word completion and guarded sync

## Confirmed defect

A failed terminal acquisition probe can finish its internal queue without earning a mastery milestone. LearnResultScreen durably settles that block and auto-continues. The next prepareLearnSession call discovers no executable work, persists executionExhausted while retaining status=active, and returns waiting. LearnPage previously rendered its five-more landing immediately; neither the visible completion surface nor its guarded S2 handoff was reached.

This is distinct from loss of the last local answer. The corrected flow must preserve unresolved words and must not invent completion/mastery evidence.

## Change

- LearnPage reconstructs a terminal preparation result from flushed durable rows and displays the existing LearnResultScreen. It does not settle the block or save its last answer again.
- LearnResultScreen also accepts an already-settled controller result without a Typing context. Exhausted rounds show an honest end summary, cannot auto-continue as an internal checkpoint, and use the existing guarded completion sync.
- A typed, account-bound, expiring, tab-local roundEnded handoff flag distinguishes exhaustion from dailyComplete. It does not change the V4 workspace schema, record identity, mastery/FSRS rules, cloud transport or CAS/merge implementation. Ordinary interim sync still requires its existing per-account opt-in.
- The pre-mount completion card locks actions during sync. Success offers five more through an explicit navigation intent; failure preserves explicit retry/local-only exit. The existing extension helper consumes that intent once and retains unfinished words first.
- Added a product/main CI workflow for the full completion journey and existing guarded sync controls. Only synthetic local fixtures and HTTP responses are used; no real service/account mutation or etest/master promotion.

## Evidence

- Pre-fix proof: same final regression run against the five original source files from 279bd3bc, 1 expected FAIL in 26.4s. Actual last answer was saved, blockCount=1 and executionExhausted=true; the visible page showed 再学 5 词 without the completion-sync card. Fixed sources restored in a finally block. Local log: .review-test/learn-completion-before-fix.txt.
- Final focused browser suite: 12/12 PASS, 59.6s. Five new actual-keyboard journeys plus seven existing guarded S1/S2 and sync-dialog cases. Includes clean completion, failed terminal recall, sync failure and explicit retry, anonymous local end, and a nonterminal queue that must continue instead of syncing.
- Upload assertions inspect the actual gzipped V4 body produced by the guarded executor, verify its hash/account and final answer, verify retained unmastered state, and require exactly one upload. Following five-more and reloading cannot append another five words. Remote HTTP is simulated: this is not real EdgeOne/Blob qualification.
- Existing extra-word browser suite: 4/4 PASS, 1.4m. Covers result/landing entry, reload, unfinished-first five-word cap, and old queue recovery.
- Sync boundary contracts: 8/8 PASS, 263ms, including round-end without false mastery, wrong-account denial, malformed/stale context and unchanged disabled interim-sync behavior.
- Scoped ESLint: 0 errors, 4 existing warnings (three non-null assertions in src/index.tsx and the existing LearnPage cleanup-ref warning).
- TypeScript: no diagnostics in changed source files; whole-repository check remains non-green with 147 diagnostics elsewhere. No full typecheck PASS claimed.
- Architecture: PASS, 62 Learn/Review modules + 3 low-level files.
- Build: PASS, Vite 58.06s, Yarn 60.85s. Existing directive/chunk-size warnings retained.
- git diff --check: PASS.
- Gate-manifest validation: existing FAIL, REG-20261004-LEARN-SINGLETON-STALL references absent test title “full VirtualLearnApp blindly rediscovers the admitted-based singleton loop mutation”. Validator, manifest and referenced system-driver test unchanged by this task. This unrelated gate defect was not hidden or weakened.

The initial test setup required correction to wait for the actual start/input-feedback states and to seed an unfinished final probe rather than generate a queue with optional introductions. The final fixture uses the production terminal-probe/plan constructors and never presets completion or sync intent.

## Delivery

Implementation commit: da343d41428537c46d65453b14376e94cf0f4a8f. Final upstream fetch still observed 279bd3bc1ff99c548ca515ebc373d3146db94f3b; no integration was needed. Push target is product/main only. Unrelated CURRENT_TASK remains unchanged. Published Pages, real EdgeOne/Blob and the user's original account are not claimed verified by these local results.


## Authorized staging qualification follow-up (2026-10-25)

Owner requested CI inspection, then etest and the real last-word/completion/sync/five-more journey. Execution base c594f89e; integrated independent mobile copy commit d256ca5b by fast-forward. Production remains 5528f79c. Staging contains independent session-handoff work (observed 34a3d15f); preserve it in a separate staging merge, do not import the experiment into product/main.

At c594f89e, Learn Completion Journey, Cloud Sync, Learn Real Journey, Mobile P0, Achievement, Pages deployment and read-only admission passed. P4b and S1 exposed obsolete login/logout copy expectations and a cloud-backup button now under More sync options. Updated those interactions while retaining the original owner/record/hash assertions. Local focused checks: download and reauth 2/2; cancellation 1/1 after waiting up to 15 seconds for cold app readiness (same eventual-state assertion). Published dual-site Explorer still expected the obsolete mobile information screen on production; both canonical sites now have the mobile menu, so require the same menu/start-link/no-auto-start invariants. Review had executed all 118 Learn cases before a newer product/main push cancelled it; a fresh candidate run is required. The advisory Pages Explorer also got cancelled and already showed two failures; do not count it as a pass.

Added etest Learn Completion Cloud Journey: two fresh disposable accounts, unfinished terminal-probe BEFORE fixture only, final answer through shipped keyboard UI, honest completed/unmastered result, real V4 revision increment, five-more and reload, fresh browser-profile Blob pull with exact final-record readback, and verified deletion of only those test accounts. No cloud route mocking, no forced merge, no relaxation of ambiguous-write retry rules, no credentials in artifacts. Workflow waits for the exact deployed source marker; product/main only loads the test, never creates accounts. Actual staging result pending.


Further CI evidence: at 8e5e41ac, Learn Completion Journey, Cloud Sync, S1 Workspace and P4b Recovery passed. Published dual-site Explorer passed at 8b9cf082. Parallel mobile copy changes required updating retired labels only: theme now asserts actual persistence across reload (local 1/1), progress still requires identical 1/1 and frozen 0/32 values under the new short labels.

Local staging integration c1c30676 retained all cloud-functions bytes from 34a3d15f unchanged. Focused completion suite PASS12/12 (62.59s). Full local cloud contracts 778/780: two existing staging handoff failures in s2-write-route.test.mjs, expected request_body_unavailable but received handoff_auth_body_unavailable, so the established safe retry does not run. This is a real compatibility issue, not a test weakened for green. No auth/transport fix made here. Asked owner whether to proceed with completion-only etest qualification while preserving this separate pilot blocker, or wait for the cloud thread. No staging push at this checkpoint.
