---
task_id: SESSION-HANDOFF-20261025
status: IN_PROGRESS
executor: ChatGPT (scoped integration)
base_commit: ba987ca9af7bece0683beb3870a8061013b624ad
upstream_inspected: dd30e54ac77c7bb43228f0207365e92c98033d78
target_branch: product/main
report_file: interactive/reports/SESSION-HANDOFF-20261025-narrowed-merge.md
staged_runtime: 34a3d15f35ede8dec073fa88deaa5f3125f2ee95
release_to_master: false
---

# Narrowed handoff acceptance (owner direction)

Wait for old execution to STOP, not for every upload to succeed. Block new old-
session work; drain admitted effects; close the old write scope; allow takeover
on success OR proven stopped failure. Preserve the original failure and all
client-owned local data/pending synchronization. Never mark a failed sync as
successful merely to release ownership. Existing local merge remains unchanged.

Owner authorized continuing integration. Merge the qualified feature into
product/main, preserving its independent CURRENT_TASK/idle executor and current
UI/Learn changes. No master release, database provisioning or migration.
Historical intermittent request-body failures are explicitly OUT OF SCOPE and
are NOT a prerequisite to this scoped development merge. Retain their failed
reports; do not weaken any production release gate or claim they were fixed.

This increment handles thrown application/read failures after request scope
closure and acknowledged drain. Rejected provider mutations, in-flight writes
and unverified terminal receipts remain uncertain; Promise rejection alone is
NOT proof of remote cancellation. No timeout unlock or forced cancellation.

Six focused regression checks cover the new distinction. Reuse existing CI
contracts once for integration; do not expand unrelated failure campaigns.
The gateway account selector and existing fixture capacity are NOT changed by
this merge. Code integration is not ordinary-account activation or deployment.
Previous isolated live results remain valid for their exact older runtime SHA;
the new stopped-failure behavior requires its own evidence before live claims.
