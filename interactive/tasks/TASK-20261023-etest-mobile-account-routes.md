---
protocol_version: "1.1"
task_id: "TASK-20261023-etest-mobile-account-routes"
status: "IN_PROGRESS"
executor: "Codex (independent mobile UI / staging verification)"
target_branch: "product/main"
claim_base_commit: "28d8b3bf86cbf42facb24bf091a50151c404e21f"
report_file: "interactive/reports/TASK-20261023-etest-mobile-account-routes-report.md"
release_to_master: false
---

# etest 手机账号真实入口与认证验证

用户明确纠正登录等云功能需推送 etest；该指示授权本次隔离测试站推进和人工测试账号验证，master 不动。此前候选 28d8b3bf 已在 Cloud/Pages/Admission 同 SHA 通过后正常快进推送 etest。

etest 实际部署 28d8b3b 后：手机新菜单已出现，但点击 /mobile/account 被 404 allowlist 回退为 /，进而回到 /mobile。没有创建账号。此任务补齐 Maker 嵌套路由登记与物理 HTML 入口，并添加真实手机入口回归。保持认证、安全工作区和 API 路由边界。

- 修复 /mobile/account 与已有 /mobile/study 的严格 SPA 404 恢复、index marker 解码及物理入口；未知路径、/api、/assets 仍不可被恢复为客户端路由。
- Node 合同、两种构建、Pages/本地账号回归；记录主线源码/报告；等同 SHA 的 Cloud+Pages+Admission 准入后正常快进 etest。
- etest 验证实际版本，然后用独立临时账号走手机注册、退出、登录、身份读回，删除仅本次确认创建的测试账号并确认失效；密码只在进程内存，不写日志/trace。
- 其他并行云同步实网失败独立报告，不将手机登录成功称为多设备自动收敛完成。

CURRENT_TASK 归属保留；master、生产账号/Blob 与部署开关不动。
