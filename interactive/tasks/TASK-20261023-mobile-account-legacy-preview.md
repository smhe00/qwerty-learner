---
protocol_version: "1.1"
task_id: "TASK-20261023-mobile-account-legacy-preview"
status: "REVIEW"
executor: "Codex (independent mobile UI fix)"
target_branch: "product/main"
claim_base_commit: "618f3b222cae3fd9605387a99797b2619b8d0126"
report_file: "interactive/reports/TASK-20261023-mobile-account-legacy-preview-report.md"
release_to_master: false
---

# 已有旧数据的手机登录预览被 S1 迁移门禁阻断

用户截图明确报错：账号管理需要 S1 安全工作区，旧版数据不能直接切换账号。本任务修复同一手机 UI 的遗漏分支，不替换 CURRENT_TASK。

- Pages/云认证关闭时，在原 guarded boot 后允许 legacy 浏览器查看纯展示手机账号预览。
- 不挂载 React/RecordDB 写入树，不引入认证/工作区切换处理器，不迁移或删除本机旧记录。
- 保留真实可认证部署的 S1 归属确认，不能把 readonly 预览例外扩大为允许旧数据登录。
- 新增真实 Pages 生产构建回归：已有旧 IndexedDB 记录、旧账号凭证保持字节与归属不变；禁用认证且零 API 请求。保留 fresh Pages 及标准手机账号回归。
- lint/build、报告、正常 product/main 提交推送；不推进 etest/master 或改变部署开关。
