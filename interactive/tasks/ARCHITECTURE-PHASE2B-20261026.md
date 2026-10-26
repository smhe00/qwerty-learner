---
protocol_version: '1.1'
task_id: ARCHITECTURE-PHASE2B-20261026
status: REVIEW
executor: Codex
target_branch: codex/architecture-remediation-phase2b-20261026
base_commit: a11362de0e93736e2cc68918f1f267f41e45da21
allow_parallel_executors: false
report_file: interactive/reports/ARCHITECTURE-PHASE2B-20261026-report.md
release_to_master: false
---

# 阶段 2b：学习记录应用接口拆分

用户授权先检查/合并 PR #46，再推进阶段 2b；保留数据安全、独立工作区，不影响其他任务，不发布 master。PR #46 的 3 项 CI success，review/comment/thread 均为空（无外部批准记录）；本轮复核无阻塞后按锁定 head c70ac66 正常 merge，主线结果 a11362d。

沿用本任务独立目录 `C:/Users/peter/Documents/Codex/2026-10-26/qwerty-architecture-remediation`，从合并后主线创建本任务分支。CURRENT_TASK 归其他任务；起初为统一 UI 发布，后随上游更新为 ACCOUNT-PASSIVE-RETURN，均保留上游原样。本阶段以独立 PR 交付，不自行合并新的阶段 2b PR，不推送 master/edgeone-test，不 force push。

## 调用者与边界

| 调用者 | 输入职责 | 提交服务职责 | 完成行为 |
| --- | --- | --- | --- |
| Word 桌面拼写 | 冻结 telemetry/context、分类与评分、下一练习 shadow | 原格式构造、原身份生成、原 db 写入、提交后副作用 | Learn 必须有保存回执；Typing 保留历史失败推进语义 |
| MobileWordPractice（含桌面 Tap Recall） | 自评/客观拼写/训练分别采证；不把自评改成拼写证据 | 与桌面同一提交服务，FSRS/成就/M3 只在原始提交后调度 | 保存回执进入内存草稿，返回同一页面不重复提交 |
| WordPanel | 已提交结果消费 | 校验 Learn 回执与记录/当前词/词书一致 | 校验前不改变队列或结算 |
| reviewInfoAtom | 同步 route cache 和 terminal guard | 共享 ReviewRecord writer 持有单文档队列 | 原有快照/串行顺序；flush 失败仍可见 |
| Learn flush、workspace/V4/recovery flush | 等待持久化边界 | 导入同一个独立 writer，不再导入 Jotai/store | 不改变锁、journal、所有权或恢复顺序 |

## 结果/失败矩阵

| 情形 | 返回值 | raw write/副作用 | Learn |
| --- | --- | --- | --- |
| session-finished | rejected | 0/0 | 不推进 |
| 记录构造异常 | failed / prepare | 0/0 | 保留证据 |
| 原始写入拒绝/abort/无效 ID | failed / write | 不运行副作用 | 不推进，沿用显式重试 |
| 原始提交成功 | saved + 不透明类型回执 | 正好一次 raw add；派生调用已注册 | 可完成 |
| 提交后通知/成就/发布/FSRS 失败 | saved；effects 内 rejected | 原始保存仍成功，禁止以此重写 | 不阻断；保留现有重建/扫描 |
| 页面离开后原始提交完成 | saved | 保留提交；派生任务可正常重建 | 旧界面不推进新页面 |

回执仅本地内存应用协议，不持久化、不作为云同步证明；保留 attemptId 生成器、WordRecord/schema、Typing retention、FSRS/成就、单会话/所有者保护以及全部 S1/S2/M3/M4、journal/未知写入处理。

## 验收与交付

- [x] 两个调用者都迁移到同一应用接口；旧 useSaveWordRecord 实现无残留调用。
- [x] 应用服务不依赖 React/Jotai/store；UI 不自行构造 saved receipt；完成类型不再定义于 UI 组件。
- [x] 记录构造与旧版逐字段等价；已保存结果不被后续异常覆盖；副作用互不阻断。
- [x] ReviewRecord 单文档队列共享，快照隔离、顺序、flush 与错误传播有行为测试；移除 Learn 对 store 的门禁豁免。
- [x] 继承 PR #46 全部失败边界；补触屏失败/返回与类型回执负例；关键正常流程、准入/Typing、workspace flush 验证。
- [x] scoped lint、与同基线 type 对照、build、最新上游差异复核。精确结果见报告；不代表全仓类型检查通过。

PR 的 CI 与审查状态按其最终 head 在 GitHub 独立核对；本地结果不代替 CI。实现提交 7fa8771，正常合入其他任务的 15fffa2 后集成提交 ba4927e；未修改对方 CURRENT_TASK 或报告。

交付代码、测试、模块说明、执行报告和独立 PR。阶段 3/4/5 不混入本次改动；如具体检查有历史基线失败，记录实情，不改安全断言来变绿。
