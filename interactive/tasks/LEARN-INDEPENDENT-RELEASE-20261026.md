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
