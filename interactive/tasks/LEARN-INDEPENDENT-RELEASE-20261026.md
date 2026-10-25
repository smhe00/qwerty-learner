---
task_id: LEARN-INDEPENDENT-RELEASE-20261026
status: IN_PROGRESS
executor: Codex
target_branch: release/learn-completion-20261026
base_commit: 5528f79c700548e174fa153b96ff4599d7326aee
release_to_master: true
---

Owner explicitly authorizes investigating historical-login failure, preparing an independent last-word/completion/sync/five-more fix, then publishing master after validation. Intermittent HTTP503 is an accepted known issue, not a release blocker. Preserve failed evidence and fail-closed writes; no ambiguous replay. Keep handoff experiment staging-only and do not ship unrelated source-managed idle-cleanup activation. Preserve current main and etest trial via isolated branches/snapshot; use staging temporarily for exact candidate qualification, then restore trial via a normal forward commit. Same-source Pages, live Cloud/Blob, hard3-device and release-ready remain required. Separate candidate branch support must retain exact SHA checks and ordinary main-path behavior, never mark failed tests green.

Diagnosis starts at maincd6ac70d with deployed etest9620e33c. Existing history failure only recorded revision0 vs1 after an upload request; no response/status/phase proof. Add bounded redacted diagnostics, reproduce with disposable accounts and normal account UI, verify local preservation and cleanup. Production base remains5528f79c.
