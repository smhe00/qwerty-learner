---
protocol_version: '1.1'
task_id: ARCHITECTURE-PHASE2B-20261026
status: REVIEW
executor: Codex
target_branch: codex/architecture-remediation-phase2b-20261026
claim_base_commit: a11362de0e93736e2cc68918f1f267f41e45da21
implementation_commit: 7fa8771ab6a6c526b9ff14642018accf8e0d9fcb
integration_commit: ba4927e18e9b27046d1676ac5e8ab00923dc8722
upstream_head_at_validation: 15fffa2c762037d8b29d1e5b953c729001ad5f0e
release_to_master: false
---

# 阶段 2b 接口拆分执行报告

## 结论与范围

PR #46 已按用户授权合并到 product/main；本批继续完成阶段 2b，提交独立 PR 供复核，不自行合并新的 PR。模块契约见 `docs/LEARNING_PERSISTENCE_INTERFACES.md`，调用者与失败矩阵见同名 task。阶段 3–5 仍未完成，本报告不是发布资格证明。

继续使用本任务独立 clone `C:/Users/peter/Documents/Codex/2026-10-26/qwerty-architecture-remediation`。没有接管其他任务的工作区或 CURRENT_TASK，没有对 master/edgeone-test 执行 push，也没有操作真实用户数据。

## PR #46 检查及合并证据

- 锁定待合并 head：`c70ac66ab7e73c25aca81411a3a877e60529a1f1`。
- Learn Completion Journey：[success](https://github.com/smhe00/qwerty-learner/actions/runs/40276712697/job/121420892714)。
- Learn Block Auto Sync V4 Feature Gate：[success](https://github.com/smhe00/qwerty-learner/actions/runs/40276712634/job/121420892743)。
- Performance P0-P1 Branch Gate：[success](https://github.com/smhe00/qwerty-learner/actions/runs/40276712594/job/121420892639)。
- review submissions、inline threads、discussion comments 均为空：没有外部批准记录，不能称为外部审查通过。本轮复核 head 差异、上游变更和数据安全边界，未发现阻塞问题。
- 使用 expected_head_sha 正常 merge，结果为 `a11362de0e93736e2cc68918f1f267f41e45da21`，不是强推或 master 发布。

## 为什么拆分，以及拆到哪里

原 `useSaveWordRecord` 同时负责 React 上下文、记录构造、数据库写入、通知与派生任务；完成结果类型定义在 UI 组件内，两个调用者各自拼接保存结果。ReviewRecord 队列由 Jotai 模块持有，使 flush 消费者反向依赖 store。

| 文件/模块 | 本次职责 |
| --- | --- |
| `src/learn/word-record-commit.ts` | 可注入 prepare/add/effects 端口；显式 rejected/failed/saved；成功后才生成回执 |
| `src/utils/db/word-record-builder.ts` | 沿用 WordRecord、时钟、attemptId 和 Typing retention；不重算评分 |
| `src/utils/db/word-record-commit.ts` | 组装原数据库写入与通知/成就/M3/FSRS；提交后错误不覆盖 saved |
| `src/hooks/useWordRecordCommit.ts` | 只绑定会话上下文及 UI 通知 |
| `src/learn/word-completion.ts` | 共享完成协议；Learn 必须提供回执，WordPanel 校验后才推进 |
| Word、MobileWordPractice、mobilePracticeDraft、WordPanel | 共用提交接口和实际保存记录；移除重复记录组装和 UI 内 FSRS 调度 |
| `src/utils/db/review-record-writer.ts` | 单文档共享串行队列；保持快照隔离、写入顺序和 flush 失败传播 |
| reviewInfoAtom、learn/persistence、四个 sync flush 消费者 | store 请求写入；flush 直接依赖 writer；四个 sync 文件仅替换导入路径 |
| `src/utils/db/index.ts` | 删除旧 hook，无保留重复实现或兼容旁路；其他 hook 保持原职责 |
| 架构检查及 CI | 移除 Learn→store 豁免；增加低层边界和行为/类型负例；保留 PR46 故障回归 |

回执是内存中的不透明 TypeScript 类型约束，不是安全令牌或云端 ACK，也不新增持久化字段。运行时共享入口还会检查当前词书、单词、ID、attemptId 的一致性。普通 Typing 保留历史保存失败推进语义；桌面拼写、触屏自评、acquisition/review 的证据语义不合并。

FSRS 待保存任务在 saved 返回前注册，确保最后一词结算能等待它。慢副作用不阻塞 UI，失败逐项可观察，不能因此重写原始 WordRecord。继续保留原扫描/重建路径和离开页面后不调用旧完成回调的约束。

## 已执行验证

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| Node 应用协议/队列/类型/依赖契约 | 23/23 PASS | prepare/write 异常、无效 ID、成功回执、并发身份隔离、副作用失败、共享队列及 flush、类型负例、架构负例、mobile 契约 |
| 保存故障浏览器回归 | 7/7 PASS | PR46 原 6 项加触屏失败→显式重试→菜单返回，仍只保存一次；含真实 Dexie 事务 abort |
| 正常结算浏览器回归 | 12/12 PASS | 最后一词、保留未掌握词、daily complete、同步失败显式重试、匿名及内部队列边界 |
| Review/练习定向回归 | 7/7 PASS | 多词完成、Typing、Tap Recall 暂停/纠错/按住键、新词准入、canonical FSRS 评分、reinforcement、触屏键盘连续两词 |
| Workspace/V4 定向回归 | 5/5 PASS | 旧记录、完整 V4 导出、keep-cloud 恢复、switch journal 重载、隔离工作区阻断 V1 |
| 架构检查 | PASS | 65 个 Learn/Review 模块、5 个低层文件、ReviewRecord 适配器 |
| 修改源码 ESLint | 0 errors / 7 历史 warnings | Word 1、WordPanel 2、v2-recovery-ui 3、workspace-v4-browser 1；新模块无 warning |
| TypeScript 同基线比较 | 147/147，新增 0 | 全仓检查仍失败，不能称为 typecheck PASS；按文件/错误码/消息多重集比较，未屏蔽历史错误 |
| `yarn build` | PASS | Vite 和 SPA 路由产物完成；仍有大 chunk 等既有提示 |
| `git diff --check` | PASS | 无空白错误 |

共 31 项不同的浏览器用例，不将重跑重复计入。浏览器使用本地 Chromium/Chrome 与模拟云路由，触屏是移动布局，均不等同物理手机或真实 Cloud/Blob 验收。

测试开发记录：builder 单测首次加载真实 learning-clock 的依赖链时遇到 import.meta，改为只注入时钟端口；仍执行真实 WordRecord 和 retention，并逐字段验证预期记录。没有修改产品断言来通过测试。环境仅给当前测试进程设置 `NO_PROXY=127.0.0.1,localhost`，使用本任务空闲端口，不停止或复用其他任务服务。

## 上游集成

初始基线为合并 PR46 后的 a11362d。提交前 fetch 发现 15fffa2，包含另一任务的账号被动返回优化与测试修正；与本批无重叠文件。读取其 CURRENT_TASK、任务、报告后，在本分支正常 merge 为 ba4927e，保留其所有代码、指针及报告。

集成源码补测保存故障 7/7、结算 12/12、启动/后台循环契约 35/35，架构门禁和 build 通过。35 项包含 passive return 单次消费、失效 ticket、S1/S2/manual/M4 journal 优先恢复、所有权/witness 保护和未知写入不立即重试。类型与集成上游 15fffa2 再做同基线对照，仍为 147/147、新增 0；没有把对方已执行的 880 项测试记成本任务验证。

阶段 2b CI 应按独立 PR 最终 head 在 GitHub 检查；这份版本化报告记录本地验证，实时 CI/外部审查结果放在 PR 描述中，不能用 PR46 的绿灯替代新 PR 的检查。

## 复现命令

```powershell
$env:NO_PROXY='127.0.0.1,localhost'
$env:QWERTY_TEST_PORT='53761'
node --test tests/learn/persistence-boundary.test.mjs tests/learn/persistence-architecture.test.mjs tests/learn/word-record-commit.test.mjs tests/learn/word-completion-types.test.mjs tests/learn/review-record-writer.test.mjs tests/learn/mobile-review-commit-contract.test.mjs
node scripts/validate-architecture-boundaries.mjs
yarn playwright test --config=tests/e2e/learn-save-failure.config.ts
yarn playwright test --config=tests/e2e/learn-completion-journey.config.ts
yarn playwright test --config=tests/e2e/review-flow.config.ts --grep 'multi-word Review|fresh Typing failure|Good correction, pause/resume|first trusted letter|clean Independent acquisition is the admission boundary|Phase D live gate|forgotten cold probe schedules'
$env:QWERTY_TEST_PORT='53763'
yarn playwright test --config=tests/e2e/workspace-v4.config.ts --grep 'application settings exports complete V4|real application loads unchanged legacy|pending switch journal survives reload|P3b keep-cloud V4 restores only|isolated workspace blocks legacy V1'
node --test tests/cloud/startup-sync-boot.test.mjs tests/cloud/m3-continuous-drain.test.mjs
yarn build
git diff --check
```

## 剩余边界与精确下一步

1. 复核阶段 2b PR 的最终 head、CI 与审查，再决定合并；本任务授权合并的是 PR46。
2. 阶段 3 先处理 BootOutcome，列全消息字符串分支、重载/占用/恢复状态和 journal 故障矩阵；以最新 product/main 为起点，纳入上游 passiveAccountReturn，不能删必需 reload 或跳过保护。云服务端口另开小 PR。
3. 阶段 4 对齐文档、gate manifest 与行为测试，再证明无动态入口/恢复职责后删除冗余。阶段 5 收敛历史类型和 bundle 问题，未来另获发布授权后才执行同 SHA 发布门禁。

没有改 schema、attemptId 生成/合并、鉴权、单会话、所有权、journal、S1/S2/M3/M4 协议或未知云写入重放策略。边界门禁验证直接导入关系，不声称已清理所有传递/动态依赖；现有大型 UI/同步模块和历史类型错误仍是后续维护成本。
