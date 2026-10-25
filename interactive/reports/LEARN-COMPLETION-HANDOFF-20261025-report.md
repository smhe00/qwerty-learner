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
