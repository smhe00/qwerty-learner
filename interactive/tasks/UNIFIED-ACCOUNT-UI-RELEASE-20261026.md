---
task_id: UNIFIED-ACCOUNT-UI-RELEASE-20261026
status: REVIEW
executor: Codex
target_branch: product/main
base_commit: 751bec7d5a69bc87000cd5ad6ff4882f897f76a0
production_base: 98697131d09393a479f30da9eb9b117e8117a0e7
release_to_master: true
---

用户2026-10-26新指令覆盖旧的“新UI只留etest”范围：etest和master必须保持同一套UI，账号入口直接进入登录/账号管理，不再出现中间概览。之后master只能快进到etest验证过的完全相同SHA，不拆UI、不cherry-pick、不做发布专属改动、不force push。测试功能通过服务端branch=etest区分，其他值使用生产安全策略。

实现已在8356b50d，测试入口对齐751bec7d；本任务记录正式统一发布范围及长期规则。保留已发布98697131全部同步/预算修复、已上线其他功能、PC同步菜单和手机一键同步。无新增云写路径。通过同SHA已发布Pages、etest真实Cloud/Blob+浏览器、三设备、release-ready后，验证master为祖先再正常快进；发布后核验q.smhe.cn实际版本、账号直达、交接试验关闭。不得重放未知提交。用户仍允许明确偶发503不独立阻塞，但完整必需门禁必须通过。

报告：interactive/reports/UNIFIED-ACCOUNT-UI-RELEASE-20261026-report.md。

交付：cbb20842已由etest同SHA快进发布master，正式PC/手机单击账号直达实测通过。详见报告。后续报告提交只进入开发主线，不再次触发Maker部署。
