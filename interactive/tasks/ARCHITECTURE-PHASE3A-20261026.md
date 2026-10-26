---
protocol_version: '1.1'
task_id: ARCHITECTURE-PHASE3A-20261026
status: REVIEW
executor: Codex
target_branch: codex/architecture-remediation-phase3a-20261026
base_commit: 78d1515a80eeb0848928ef13627139d46ac54457
allow_parallel_executors: false
report_file: interactive/reports/ARCHITECTURE-PHASE3A-20261026-report.md
release_to_master: false
---

# 阶段 3a：显式启动结果

用户明确授权检查通过后合并 PR47，继续阶段 3。PR47 head 8c28731 的三项 CI success，外部 reviews/threads/comments 均为空；本轮复核后正常 merge 为 78d1515。本任务独立 clone/新分支，不接管 ACCOUNT-PASSIVE-RETURN 的 CURRENT_TASK、工作区或发布权限，不推送 master/edgeone-test。

本阶段只处理 BootOutcome 和其依赖的占用/M4 中断错误类型。云端 auth/events/V4 端口按原计划另开后续小 PR。不是重新设计锁或事务。

| 原分支 | 显式结果 | 关键不变量 |
| --- | --- | --- |
| 允许的 legacy 或全部安全检查通过 | ready + 持锁 boot | 只有 ready 能导入/挂载应用；继续保有锁 |
| S1/S2 Pull/manual V4/M4 恢复完成 | reload-required + 恢复来源 | 原恢复顺序、通知和预算不变；释放锁，禁止当前 realm 挂载 |
| S2 Pull 已暂存 | reload-required / s2-pull-staged | 不能当成完成；新页面先恢复 journal |
| writer 被其他标签页占用 | occupied | 不偷锁、不 fallback 绕过活跃 owner；mobile 原地重试保持 |
| M4 已 stage 后失败 | blocked / m4-recovery-required | 保留 journal，不谎报恢复成功、不自动重放未知写入 |
| 冲突 journal、身份/witness/owner 改变、恢复异常及未知错误 | blocked | 不挂载；已获锁必须释放；保留原始错误用于诊断 |
| 网络/M4 可延期失败且最终检查通过 | ready | 离线学习及 outbox 保留；最终 journal/owner/witness 检查仍运行 |

生产调用者：index.tsx、mountGuardedWorkspaceApp；成功 boot 的类型消费者继续使用同一持锁能力。错误消息只显示/诊断，不能授权重载、重试或继续挂载。移除字符串分支，不引入平行旧生产 API。

验收：现有启动预算/passive return、实际 journal 恢复、native/fallback/复制标签页锁行为保持；增加不同消息/伪造旧消息/未知失败等结果矩阵，验证回调和锁释放次数；修改源码 lint、类型基线对照、build、CI。保留所有安全断言。独立 PR 交付，本轮不自行合并新阶段 3a PR。

实现提交 c683828；本地 67 项契约、21 项不同浏览器用例最终通过，build 与架构检查通过；scoped lint 0 错误/10 项历史警告，类型基线 147/147、新增 0。首次冷启动等待超时及精确验证边界见报告。PR 的实时 CI 与外部审查以其最终 head 为准。
