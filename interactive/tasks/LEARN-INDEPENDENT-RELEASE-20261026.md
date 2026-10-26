---
task_id: LEARN-INDEPENDENT-RELEASE-20261026
status: PARTIAL
executor: Codex
target_branch: product/main
base_commit: 9620e33c845f59d31cba107e14dd30754a8c0ca5
release_to_master: true
---

## Original plan (superseded by owner scope correction below)

Owner explicitly authorizes investigating historical-login failure, preparing an independent last-word/completion/sync/five-more fix, then publishing master after validation. Intermittent HTTP503 is an accepted known issue, not a release blocker. Preserve failed evidence and fail-closed writes; no ambiguous replay. Keep handoff experiment staging-only and do not ship unrelated source-managed idle-cleanup activation. Preserve current main and etest trial via isolated branches/snapshot; use staging temporarily for exact candidate qualification, then restore trial via a normal forward commit. Same-source Pages, live Cloud/Blob, hard3-device and release-ready remain required. Separate candidate branch support must retain exact SHA checks and ordinary main-path behavior, never mark failed tests green.

Diagnosis starts at maincd6ac70d with deployed etest9620e33c. Existing history failure only recorded revision0 vs1 after an upload request; no response/status/phase proof. Add bounded redacted diagnostics, reproduce with disposable accounts and normal account UI, verify local preservation and cleanup. Production base remains5528f79c.

## Owner scope correction after concurrent production update

Production advanced to9620e33c during diagnosis. Owner explicitly selected: preserve newly released other functions, remove only the handoff experiment from production. Earlier5528-only candidate is superseded and MUST NOT be published. New independent candidate is a forward descendant of9620e33c; source-controlled handoff policy is false. This exits before classification/body reception, fixture-account reads, health augmentation and barrier admission. Source-enabled test branch remains on etest after candidate qualification. No host/header/env enablement or console changes. Keep idle activation, mobile UI and completion fix byte-identical to9620e33c. Source files for optional experimental services remain versioned for unit tests but are unreachable through the production gateway.

## Current deployment plan (owner environment update)

Owner added server variable branch=master on production and branch=etest on staging. Use ONLY this trusted deployment binding (context.env or literal process.env.branch); missing/unknown values disable handoff. Same SHA can now be tested and released through normal main/etest/master gates while etest retains pilot continuously. Independent18767e32 source-policy-off candidate is superseded and MUST NOT be promoted. No special release-branch gate support is needed. All newly released UI/cleanup/completion behavior is retained.

Current checkpoint: candidatea3098622 has source CI/Pages PASS and required runtime isolation. Production NOT updated. Non503 fresh-profile application mount remains unqualified; live staging moved concurrently tob927b31. Waiting on explicit cross-thread coordination authorization; do not overwrite shared etest or publish unqualified candidate. See report and retained evidence.

## Owner decision: preserve current etest and wait (2026-10-26)

Owner selected: preserve current etest; wait until the other thread finishes before continuing release. Do NOT message the other thread to stop, interrupt it, or replace its test deployment while it is working. Previous request for coordination authorization is resolved by this choice. Keep master unchanged until fixed-version qualification and the non503 fresh-profile login/mount failure are resolved. Once the other thread has actually completed, refresh branch/source evidence and resume the already authorized independent release, preserving unrelated work and the etest-only experiment. A quiet thread follow-up may check completion; no unchanged-status notifications.

## Resumed after UI completion

Other thread completion verified from merged PR44 plus pinned real UI PASS40245980072. Waiting heartbeat is paused. E48 non503 fresh-profile failure is now classified: original60s test budget expired during successful synchronous immutable-evidence checks; without any replay or intervention the app mounted by the second10s observation sample. Fixed only the two live login wait budgets to180s, retaining all functional/data-safety assertions. Follow report for exact evidence and next same-SHA qualification; production and etest have not yet been replaced by this task.

## Independent v2 candidate after concurrent manual-Sync UI completion

Unless the owner explicitly expands production scope, retain the original instruction to change only production environment isolation. This isolated branch normally descends from db8f7b76, then excludes only PR43/44's unreleased manual-Sync UI. Production runtime differs from9620e33c in EXACTLY runtime-environment.js, session-handoff-deployment-policy.js and session-handoff-gateway.js, with immutable approved blob hashes. Source remains env-dependent: only trusted server branch=etest enables experiment.

The exact named branch release/production-no-handoff-20261026-v2 is the approved source for this one independent qualification. This task overrides the usual main-only source selector, not any acceptance assertion: exact source/actual Pages/actual etest SHA, backend contracts, real browser/Blob, HARD3-device and release-ready still required. The existing main path remains supported. Production-base drift and all other runtime changes are rejected.

Current etest db8f7b76 and its new UI must finish its in-progress checks before any temporary independent candidate deployment; do not mix those results with this candidate. After independent release, restore the complete saved main tree through a new forward commit that retains candidate ancestry; restore etest's UI/experiment and Pages without force pushes. No cross-thread messaging is authorized. Candidate is only locally prepared and NOT yet qualified/published.
