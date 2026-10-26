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
| 2b：完整应用接口 | 将 hook 中记录构造/持久化/副作用拆成显式端口和结果类型，UI 只采证及呈现；统一 WordFinishResult 的 durable receipt；逐步迁移 ReviewRecord 写队列所有权 | 明确区分拒绝、已保存、派生失败；UI 不能自行构造成功回执；桌面拼写/触屏自评保持各自证据；对故障、取消、重入做行为测试 | 后续独立 PR；先列出所有调用者与异常矩阵，不改 schema/attemptId |
| 3：启动与服务依赖 | BootOutcome 替代消息 includes；显式恢复/重载/占用状态；云服务按 auth/events/V4 存储端口划分，保留事务与锁边界 | 每一旧启动分支与恢复日志结果对照一致；旧新故障矩阵一致；禁止删除必需 reload 或绕过保护 | 依赖阶段 2；逐模块 PR，涉及恢复/云写入时运行对应数据安全契约 |
| 4：文档和门禁一致 | 修正文档 V2/结算同步描述、gate manifest 失效测试标题与触发路径；建立规范→实现→行为测试映射；逐项确认未引用模块/依赖再删除 | manifest 验证通过，引用测试改名必触发检查；过时规范标明替代关系；删除前证明无入口/动态使用/恢复职责 | 独立文档/门禁 PR；保留历史事故证据，不靠删除失败项变绿 |
| 5：发布候选验收 | 收敛剩余基线类型问题、复核 bundle 与完整回归、真实设备体验 | 未来另获发布授权后才运行同 SHA Pages、etest Cloud/Blob、release-ready 并给出发布建议 | 当前不发布、不推进测试站 |

本批交付阶段 1 和 2a；2b–5 保留为有验收标准的后续任务，不把一个大重写混入紧急修复。

本批状态：阶段 1、2a 已实现并完成本地验证，进入 REVIEW；后续阶段尚未实现。

后续进度（2026-10-26）：阶段 1/2a 已经 PR46 合并（a11362d）；阶段 2b 已经 PR47 合并（78d1515）。阶段 3a 的显式 BootOutcome 已实现并本地验证，进入独立 PR 审查，见 `ARCHITECTURE-PHASE3A-20261026.md` 与报告。阶段 3b 云服务端口、阶段 4 文档/门禁/冗余和阶段 5 发布候选仍待完成；原表验收边界不变。

## 本批必须验证

- 本地 Playwright 保存失败、事务 abort、重复点击恢复、最后一词不结算、页面切换、派生失败、成功完成路径。
- 持久化结果及 pending registry 行为测试；已有 mobile review contract 和架构门禁。
- 修改源码的 ESLint；全仓类型诊断与同基线对比，区分历史问题。
- 一次本地 build；不将本地测试作为真实 Cloud/Blob 或物理设备证明。
- 推送前检查上游变化；若有冲突，不覆盖其他工作，不强推。

交付：独立提交、PR、执行报告、后续精确起点。发布权限 `false`；允许推送本任务分支，禁止 force push、删除分支和发布 master。
