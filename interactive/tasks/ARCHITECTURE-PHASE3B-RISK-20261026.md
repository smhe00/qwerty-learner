---
protocol_version: '1.1'
task_id: ARCHITECTURE-PHASE3B-RISK-20261026
status: REVIEW
executor: Codex
target_branch: codex/cloud-refactor-risk-assessment-20261026
base_commit: 91b773b7f54ad77e7c2d09d9ab0f01e095df8c88
allow_parallel_executors: false
report_file: interactive/reports/ARCHITECTURE-PHASE3B-RISK-20261026-report.md
release_to_master: false
---

# 阶段 3b：保留成果并评估云接口拆分风险

用户担心此前长期调试的云端行为因架构整理再次失稳，要求“保留好成果，充分评估修改风险”。本任务延续整改目标，将云服务拆分从预定实施项改为需证据支持的候选项。“端口”指代码依赖接口，不涉及网络端口、域名或部署拓扑调整。

## 范围与隔离

在本任务独立 clone `C:/Users/peter/Documents/Codex/2026-10-26/qwerty-architecture-remediation` 的文档分支执行。只修改本任务的计划、任务和报告；不改云端或客户端源码、测试、依赖、CI、数据格式。PR #48 原提交保持不动。

CURRENT_TASK 的 ACCOUNT-PASSIVE-RETURN 仍由另一任务拥有。本任务不接管、改写或推进它，不修改其他工作区，不推送 product/main、edgeone-test 或 master。用户对 PR #47 的合并授权已完成，不延伸为对 PR #48 的合并授权。

## 必须完成

1. 留存 PR #46/#47/#48 的精确提交、状态、验证出处和证据限制。
2. 只读核对 HTTP 入口、backend factory、Blob adapter、V4 校验、客户端重试及 handoff 保护的真实依赖。
3. 区分维护负担与必要的兼容/安全机制，给出分级风险、准入条件和停止条件。
4. 调整阶段 3b 计划；保持阶段 4 的文档/门禁工作可继续，不以完成拆分数量衡量进度。
5. 检查文档差异与相对链接；证明相对于基线，所有非本次文档路径无变更。检查上游是否变化后推送本任务分支，创建独立文档草稿 PR，不合并。

## 验收与证据边界

- [x] 既有代码成果和历史失败记录保留，PR #48 不重写。
- [x] 形成带源码定位的契约、依赖和风险清单，说明不能删除的“重复”检查。
- [x] 明确低风险后续工作与高风险暂缓项，列出行为对照、故障和真实云验证门槛。
- [x] 不把测试文件存在称为测试通过，不把本地/旧 SHA 证据称为当前云验收。
- [x] 本次差异限定为三份整改文档；无业务源码、测试、CI 或用户数据变更。

无需为纯文档重复运行应用构建、浏览器或云端测试。复核 `git diff --check`、变更路径和历史分支 SHA 即可；若发现需要修改运行时的问题，另列具体候选及验证要求，不在本任务顺手实现。
