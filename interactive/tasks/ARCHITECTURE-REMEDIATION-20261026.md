---
protocol_version: '1.1'
task_id: ARCHITECTURE-REMEDIATION-20261026
status: REVIEW
executor: Codex
target_branch: codex/architecture-remediation-phase1-20261026
base_commit: 98697131d09393a479f30da9eb9b117e8117a0e7
allow_parallel_executors: false
report_file: interactive/reports/ARCHITECTURE-REMEDIATION-20261026-report.md
release_to_master: false
---

# 架构审计分阶段整改

依据：[2026-10-26 审计报告](https://chatgpt.com/space/page_43492eae680481918e2effcf56e46fe7)，审计基线 e4a4e4f9；本任务重新检查 98697131 上相关实现。
用户授权：先修复保存失败仍推进，逐步理清接口和依赖；保留数据安全机制，在独立工作区执行，不影响其他任务，不发布 master。

## 隔离与不变量

独立目录 `C:/Users/peter/Documents/Codex/2026-10-26/qwerty-architecture-remediation`。使用本任务独立分支并提交 PR 到 product/main，不直接推进 product/main、edgeone-test 或 master。现有 CURRENT_TASK 指向另一发布验收任务，本任务不接管或改写其任务/报告/指针。这是用户要求隔离、不影响其他任务对默认主线提交流程的具体落实。

原始 WordRecord 是事实来源，只有持久化成功才可推进 Learn；派生 FSRS/成就失败不撤销原始记录、不要求重新作答。保留 attemptId、数据格式、单登录会话、所有者校验、S1/S2/M3/M4、回滚日志及未知云写入禁止重放机制。不把 Typing 的历史行为改成 Learn 行为。不清理用户数据，不增加云端写入或测试后门。

## 阶段与验收门槛

| 阶段 | 内容与边界 | 可观察验收 | 前置/交付 |
| --- | --- | --- | --- |
| 1：持久化失败止损 | 修复桌面 Learn 保存返回失败/抛错仍完成；停在当前词，展示错误，手动重试原始冻结证据；防连续点击及离开页面后的旧回调 | 失败不改变队列/checkpoint、不结算最后一词；恢复后只写一条、只推进一次；派生失败不阻断成功保存；正常完成与 Typing 不回归 | 先故障红测，再实现/浏览器绿测，独立 fix 提交 |
| 2a：明确当前保存边界 | 桌面与触屏共享持久化 ID 校验，修复 pending tracker 拒绝链；切断 review-record → utils barrel → store 依赖环，扩展针对性依赖门禁 | 两入口采用同一失败语义；拒绝被调用方消费后无额外未处理拒绝；依赖门禁能拒绝重新引入的环边 | 阶段 1 完成后小步 refactor 提交；不改证据语义 |
| 2b：完整应用接口（已合并） | 记录构造、提交、副作用与 UI 绑定分离；明确 durable receipt；ReviewRecord 单文档 writer | 验证与边界见阶段 2b 报告，不扩大为整个系统或真实云验收 | PR #47 已合并，不重复实施 |
| 3a：启动结果接口（已取消） | 原 BootOutcome 方案涉及客户端云同步启动、writer 锁与 M4 中断恢复 | 用户要求保留刚稳定的云行为；代码及验证记录仅作历史成果 | PR #48 已关闭、未合并；重新推进需要用户新的明确授权 |
| 3b：云服务拆分（停止） | 已完成风险评估，保留接口与副作用资料 | 不修改云相关运行时，不用代码整洁作为重构充分理由 | PR #49 文档草稿已关闭、未合并；风险报告与分支保留 |
| 4：文档和门禁一致 | 修正文档 V2/结算同步描述、gate manifest 失效测试标题与触发路径；建立规范→实现→行为测试映射；逐项确认未引用模块/依赖再删除 | manifest 验证通过，引用测试改名必触发检查；过时规范标明替代关系；删除前证明无入口/动态使用/恢复职责 | 独立文档/门禁 PR；保留历史事故证据，不靠删除失败项变绿 |
| 5：发布候选验收 | 收敛剩余基线类型问题、复核 bundle 与完整回归、真实设备体验 | 未来另获发布授权后才运行同 SHA Pages、etest Cloud/Blob、release-ready 并给出发布建议 | 当前不发布、不推进测试站 |

初次批次交付阶段 1 和 2a，当时将 2b–5 留为后续任务。以下状态更新替代旧待办描述，不覆盖初次报告的历史验证证据。

## 后续状态（2026-10-26）

- 阶段 1/2a：PR #46 已合并，merge `a11362de0e93736e2cc68918f1f267f41e45da21`，见[初次报告](../reports/ARCHITECTURE-REMEDIATION-20261026-report.md)。
- 阶段 2b：PR #47 已合并，merge `78d1515a80eeb0848928ef13627139d46ac54457`，见[阶段 2b 报告](../reports/ARCHITECTURE-PHASE2B-20261026-report.md)。
- [PR #48](https://github.com/smhe00/qwerty-learner/pull/48)：按用户要求关闭且未合并，原 head `af98c482af46eee1c3a7a33ec812f5219ac1b853` 保留。没有修改服务端文件不等于与云无关；客户端同步启动/恢复同样在停止范围内。
- [PR #49](https://github.com/smhe00/qwerty-learner/pull/49)：按用户要求关闭且未合并，文档 head `2d5b19306e08ff75abdae7e2af0f4b09bd97408b` 保留。[风险与取消记录](https://github.com/smhe00/qwerty-learner/blob/2d5b19306e08ff75abdae7e2af0f4b09bd97408b/interactive/reports/ARCHITECTURE-PHASE3B-RISK-20261026-report.md) 可继续追溯，不构成实施授权。
- 用户后续批准处理只读审计发现的文档问题。本批阶段 4 仅处理状态、历史部署说明、规范和测试映射，见[任务](DOC-GATE-ALIGNMENT-20261026.md)及[报告](../reports/DOC-GATE-ALIGNMENT-20261026-report.md)。CI 触发配置另行安排；源码、测试断言和云行为保持不变。
- 历史类型基线、非云冗余及其他门禁覆盖尚未收敛；阶段 5 发布不在本次授权内。既有 #46/#47 不回退，不接管 CURRENT_TASK 指向的其他任务。

## 本批必须验证

- 本地 Playwright 保存失败、事务 abort、重复点击恢复、最后一词不结算、页面切换、派生失败、成功完成路径。
- 持久化结果及 pending registry 行为测试；已有 mobile review contract 和架构门禁。
- 修改源码的 ESLint；全仓类型诊断与同基线对比，区分历史问题。
- 一次本地 build；不将本地测试作为真实 Cloud/Blob 或物理设备证明。
- 推送前检查上游变化；若有冲突，不覆盖其他工作，不强推。

交付：独立提交、PR、执行报告、后续精确起点。发布权限 `false`；允许推送本任务分支，禁止 force push、删除分支和发布 master。
