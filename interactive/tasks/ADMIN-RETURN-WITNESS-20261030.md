---
protocol_version: '1.1'
task_id: ADMIN-RETURN-WITNESS-20261030
status: REVIEW
executor: Codex-admin-console
claim_base_commit: f2892841fa3faa48b6d48d17c7ac34a5ef2b3ad9
target_branch: product/main
report_file: interactive/reports/ADMIN-RETURN-WITNESS-20261030-report.md
release_to_master: false
etest_source_commit: 7eb3631f1614c8c78352a13bcbcae84ba165a290
acceptance: deployed_original_error_page_exit_verified
---
Fix owner-reported etest S1 storage witness mismatch when leaving administrator for ordinary login. Continue authorized admin/staging work; leave CURRENT_TASK and Circle untouched. Preserve all records and integrity checks. Prove the full S1-sealed roundtrip, legacy admin archive/anonymous restore, consented full-V4 journal recovery for the old credential deletion, denial of unrelated corruption/identity changes, and zero learning network calls during management return. Push main, pass exact-source admission, update etest once; never master.

Owner follow-up: reopening / or the old learning URL and pressing refresh / 重新检查 still repeats the witness mismatch. The first recovery was reachable only via admin-return or a manually entered /admin address. Add a visible, guarded navigation exit on the original witness error page and prove refresh -> exit -> fresh admin login -> existing full-backup recovery -> ordinary login. This UI follow-up authorizes another etest update after exact-source admission; do not change auth/storage/merge/recovery contracts or master.
