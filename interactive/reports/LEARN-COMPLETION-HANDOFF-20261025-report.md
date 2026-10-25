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


## Final development CI / staging decision checkpoint

Relevant checks are now successful; tested source additions are unchanged across the later test/report-only commits:

- Completion Journey (12 browser cases plus 8 boundary contracts): https://github.com/smhe00/qwerty-learner/actions/runs/40191978798 at f53c0ec2.
- Review Gate: https://github.com/smhe00/qwerty-learner/actions/runs/40191304465 at 8b9cf082; all earlier contracts/models and browser steps plus final Learn browser118/118 passed.
- Mobile P0: https://github.com/smhe00/qwerty-learner/actions/runs/40191978775 at f53c0ec2; local-save contracts6/6, learning browser58/58, shared account31/31, static deep-link4/4.
- S1 Workspace: https://github.com/smhe00/qwerty-learner/actions/runs/40191079555 at 8e5e41ac.
- P4b Recovery: https://github.com/smhe00/qwerty-learner/actions/runs/40191079573 at 8e5e41ac.
- Cloud Sync: https://github.com/smhe00/qwerty-learner/actions/runs/40191079545 at 8e5e41ac.
- Published dual-site anonymous Explorer: https://github.com/smhe00/qwerty-learner/actions/runs/40191304469 at 8b9cf082.
- Pages deployment: https://github.com/smhe00/qwerty-learner/actions/runs/40191978808 at f53c0ec2.

The separate advisory Pages Explorer has historical obsolete settings selectors and was not qualified by this task; earlier failed/cancelled runs remain visible. This is not an identical-SHA production release certification.

Final local candidate ba12baa436faabc4184e28636fa60a0b2e13b3b1 (codex/learn-completion-etest-20261025) merges current staging34a3d15f with developmentf53c0ec2. git diff c1c30676..ba12baa4 -- src cloud-functions is empty, so the recorded merged12/12 and cloud778/780 results apply unchanged. The two cloud failures come from unchanged staging code: handoff_auth_body_unavailable replaces request_body_unavailable before business writes, and the established safe-body retry recognizer consequently does not retry. No auth/transport code modified, failure assertion weakened, or unknown write replayed.

Owner was asked whether to preserve that independent pilot and qualify only this completion flow, or wait for the cloud executor. No answer had arrived at the checkpoint. Because the user explicitly conditioned etest push on passing CI, promotion was not executed. No new cloud account was created. Actual real-cloud completion journey is therefore NOT yet verified. Latest verified remote refs: edgeone-test34a3d15f35ede8dec073fa88deaa5f3125f2ee95; master5528f79c700548e174fa153b96ff4599d7326aee.

Resume after the decision: fetch current refs; preserve any newer staging work in the isolated staging branch without force; recheck affected tests if cloud code changes; if authorized despite the existing pilot blocker, fast-forward edgeone-test to the candidate and watch etest Learn Completion Cloud Journey. That workflow first verifies the deployed source at t.smhe.cn, then uses two disposable accounts and fresh-profile Blob readback. Require both cases and cleanup to pass. Do not update master. Keep CURRENT_TASK and IDLE activation untouched.


## Owner-approved scoped etest run

Owner explicitly answered: preserve the existing experiment and validate the completion flow. This authorizes staging despite the two documented unchanged pilot contract failures; it does not certify them or authorize production. Resume fetch confirmed product/main dd30e54a, etest34a3d15f and master5528f79c unchanged. Merge only the documentation checkpoint into the already-tested ba12baa4 candidate, verify no application/cloud source difference, and push edgeone-test once.


## Real-cloud qualification and harness corrections

Scoped approval was executed: etest advanced from 34a3d15f to dbb365840aed734e24efc97a8a04138e3d1ca7d2. Exact source marker dbb3658 was verified before account creation by live workflow40193942445. Its first run failed before learning because the harness omitted the native login workspace-switch confirmation; Playwright dismissed it. Both accounts were deleted with HTTP200 and accountDeleted=true. The corrected harness now asserts and accepts that exact confirmation.

The next local real-cloud run reached both completion pages and committed revision1, then exposed an invalid test assumption: after starting five more, ordinary startup preflight legitimately saves the changed extra-round runtime on reload (revision2). This is not a repeated final answer. The strengthened assertions now pin and hash-check the actual completion Blob at revision1 BEFORE the five-more action; require exactly one later startup upload at revision2; compare all final word rows through reload; and compare the latest runtime/review rows after a fresh-profile cloud pull. No product or cloud code was changed to satisfy these tests.

Local Chrome on the actual dbb3658 staging runtime: PASS2/2, 145.86s. Both correct and unmastered final-keyboard paths displayed the appropriate completion screen, saved one final attempt, verified exact immutable compressed Blob SHA/size and account, started exactly five extra words, did not duplicate the extension after reload, and restored identical word/review/state rows plus extra-round runtime in a fresh browser profile. All test accounts were deleted and verified. The only fixture is the unfinished BEFORE probe; no completed session, sync response or final answer is injected. This is real remote HTTP/Blob testing from local Chrome, distinct from a passing GitHub live workflow.

Concurrent change: PR41 merged the independent handoff repair into product/main at218dcd27260cee1bc9bb7d59db38a6d2c14abd81; another executor advanced etest to4c20e2663d4aee75d6888fc99a89d3302d4a95d6. Local main was fast-forwarded to that recorded merge commit. Repeated Git transport and GitHub branch listings then showed product/main absent; no source/commit loss occurred because the merge is retained in staging. This task preserves the approved development branch name and latest merged history when publishing its test/report-only follow-up. No force push or cloud implementation edit.

Ancillary dbb3658 results retained separately: M3 relay40193942423 and three-device offline relay40193942393 PASS. Branch EdgeOne40193942399 had passing live-browser-cloud and real-v4-transport jobs, but release-ready FAILED for the same-SHA Pages requirement. Safe V4 merge40193942414 failed closed on ambiguous revision after an explicit pre-write body error; login V4 case40193942396 expected5 rows and read4 during divergent reauthentication (cleanup verified). None of these is converted into a pass by the completion qualification. The old two local handoff-contract failures are historical baseline evidence; another executor has since changed that code, so do not label them unchanged current failures.

Scoped follow-up checks on merged main: completion authorization8/8 PASS; E2E test discovery2 cases PASS; ESLint with the repository TypeScript parser and plugin PASS; formatting/diff whitespace PASS. The root ESLint config does not select tests/e2e TypeScript by default, so the explicit parser is necessary. Production master remains5528f79c700548e174fa153b96ff4599d7326aee.

Latest-runtime repeat: local Chrome against exact deployed4c20e26 also PASS2/2 in136.53s, including both hash-pinned completion snapshots, revision1 then2, fresh-profile row/runtime readback and verified account cleanup. Sanitized proof for both runtimes is committed under evidence/LEARN-COMPLETION-HANDOFF-20261025/. Next: publish the test correction and run the versioned GitHub completion gate; no further runtime change is needed.

CI33687431 run40195988261 passed8/8 contracts and11/12 browser cases, but the internal-boundary case raced before typing began. Downloaded artifact12600111543: its trace shows the shared helper briefly recognizing the Learn LANDING press-any-key prompt, the route entering preparing, then the real typing screen staying idle; no key was sent, blockCount0 and cursor0. Both completion harnesses now wait for the consumed /learn resume URL and actual cancel word before startTyping. No retries or behavioral assertions removed. Targeted repeated local regression PASS5/5 in38.6s (39.54s including Yarn); scoped TypeScript ESLint and whitespace checks pass. Failed CI evidence retained; new required run pending.
