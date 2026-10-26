---
task_id: BOOT-SYNC-RECOVERY-FIX-20261026
status: IN_PROGRESS
executor: Codex
target_branch: product/main
base_commit: db8f7b76e58cf79a275d1d75b9d2c8de02059bd5
integration_base: 1d5585f0
release_to_master: false
staging_authorized: true
---
按用户明确要求修复审计发现的冗余恢复和跨刷新启动等待。增加慢网、断网、提交后响应丢失、跨刷新恢复回归，先在 etest 验证；问题解决前不发布 master。
审计：codex/login-boot-formal-audit-20261026 / 13afd515。保留原 CI40253418650 的180秒失败，不加长断言，不重放未知云写入。
继承1030测试修复并恢复主线新UI和正常门禁；保留原 qwerty-completion-release 暂存树。只在本独立工作区实现，最终快进 product/main，源CI/Pages通过后再快进 edgeone-test。
报告：interactive/reports/BOOT-SYNC-RECOVERY-FIX-20261026-report.md。
