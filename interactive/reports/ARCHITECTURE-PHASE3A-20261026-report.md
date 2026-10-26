---
protocol_version: '1.1'
task_id: ARCHITECTURE-PHASE3A-20261026
status: REVIEW
executor: Codex
target_branch: codex/architecture-remediation-phase3a-20261026
claim_base_commit: 78d1515a80eeb0848928ef13627139d46ac54457
implementation_commit: c6838281b598311bbfdd724e95a9533f6202a6eb
upstream_head_at_validation: 78d1515a80eeb0848928ef13627139d46ac54457
release_to_master: false
---

# 阶段 3a：启动结果接口执行报告

## 结论和授权范围

用户本轮明确授权合并 PR47 后继续阶段 3。PR47 head `8c287317307e1560f0e2a820e329cd887b09b9f3` 的三项 CI 全为 success，reviews/inline threads/discussion comments 均为空，无外部批准记录。本轮复核其状态、源码与主线无新差异后，锁定 expected_head_sha 正常 merge 到 product/main，提交 `78d1515a80eeb0848928ef13627139d46ac54457`。

- [Learn Completion Journey](https://github.com/smhe00/qwerty-learner/actions/runs/40285154547/job/121446945427)
- [Learn Block Auto Sync V4 Feature Gate](https://github.com/smhe00/qwerty-learner/actions/runs/40285154533/job/121446945465)
- [Performance P0-P1 Branch Gate](https://github.com/smhe00/qwerty-learner/actions/runs/40285154539/job/121446945494)

本批完成阶段 3a 的显式启动结果，独立 PR 待审，不自行合并新 PR。阶段 3b 的云服务端口仍未完成，不声称阶段 3 或整个整改已经结束。

沿用本任务独立 clone `C:/Users/peter/Documents/Codex/2026-10-26/qwerty-architecture-remediation`，从合并后主线建立新分支。CURRENT_TASK 指向 ACCOUNT-PASSIVE-RETURN，保留其指针、任务、报告及代码原样；没有修改其他工作区，没有推送 master 或 edgeone-test。

## 根因与接口变化

以前启动函数用抛出的英文 Error 文本同时表达正常恢复终点和真正失败。index.tsx 用 includes 决定自动重载/显示占用；workspace-lock 内部又用完整消息判断是否重试或拒绝 fallback，M4 两层也依赖消息判断是否必须保留恢复阻断。这使文案变化可以改变控制流，调用者类型也无法看出哪些结果允许挂载。

现在 `WorkspaceBootOutcome` 显式区分 ready、reload-required、occupied、blocked。只有 ready 携带 `GuardedWorkspaceBoot` 和仍持有的 writer lease。恢复成功/暂存后返回不同 reload reason；M4 stage 后中断返回 blocked/m4-recovery-required，不能当成恢复完成。详细旧新分支矩阵见任务文件和 `docs/WORKSPACE_BOOT_INTERFACE.md`。

| 变更文件 | 最终职责 |
| --- | --- |
| workspace-boot-outcome.ts | 结果、成功持锁能力、阶段、重载原因，以及预期失败分类；不依赖 UI 或启动实现 |
| workspace-errors.ts | 由 writer/M4 所属边界创建占用与持久恢复必需两类控制错误；原始 cause 保留 |
| workspace-bootstrap.ts | 原安全检查顺序不变，六个正常重载出口显式返回；失败释放锁；挂载 helper 仅消费 ready |
| index.tsx | 独立展示停止结果；按 kind/reason 选择提示/重载/原地重试，删除消息 includes 分支 |
| workspace-lock.ts | 三个占用产生点和两个判定点使用同一错误类型；选举/TTL/challenge/renew/release 不变 |
| m4-merge-transaction.ts、m4-witnessed-prefix-browser.ts | 仅改变中断错误创建和识别方式；不改 stage/restore/readback/seal/finalize/rollback |
| 7 个成功 boot 类型消费者 | 仅更换 type import 到契约模块，不改变业务执行 |
| 启动契约与浏览器夹具 | 旧节点测试直接断言新结果；新增 12 项错误/动作/释放次数矩阵和实际 mobile 原地重试 |
| startup-sync-recovery / s1-workspace workflow | 新增 PR 上的定向启动安全验证；补充夹具触发路径，既有发布门禁不放宽 |

原 browser harness 通过一个 **测试专用** adapter 把 reload reason 转为历史断言的文本，原事务/数据安全断言继续保留。生产没有旧异常兼容 API 或并行实现。新节点矩阵及实际应用入口直接消费显式结果，避免只改源码字符串测试。

## 验证证据

| 项目 | 结果与范围 |
| --- | --- |
| 启动及 M4 契约 | 67/67 PASS：startup-sync-boot、login-event-warning、login-startup-m4、m4-merge-transaction、v4-disjoint-m4-admission；实际执行分为 62 项和 5 项两组 |
| 启动恢复浏览器 | 10/10 PASS：PC/mobile passive return、成功/失败重认证、超时/离线/丢 ACK、真实 S2/M4 journal 与跨页预算、六表 union |
| 工作区/锁定向浏览器 | 11 项不同用例最终通过：PC 第二页面、mobile 原地重试、损坏 journal 不挂载、S1 replay、三种 native/fallback/复制 tab 占用、S2 恢复/损坏、M4 恢复/owner mismatch |
| 架构门禁 | PASS：65 个 Learn/Review 模块 + 5 个低层文件 + ReviewRecord adapter |
| 修改源码与修改 cloud 测试 lint | 0 errors / 10 历史 warnings；index 3、M4 transaction 1、manual import UI 3、V2 recovery UI 3 |
| 全仓类型基线对照 | 78d1515 与候选均 147 项，新增 0；原文件/错误码/消息多重集对照，不把全仓 tsc 记为 PASS |
| yarn build | PASS，Vite 与 SPA route entries 完成，保留既有大 chunk 等提示 |
| git diff --check | PASS |

新增矩阵验证：占用/M4 类型即使改了 message 仍被识别；普通错误即使恰好含旧控制消息，也不能授权重载或占用动作；M4 中断保留 journal/cause 且不自动重放；未知网络异常仍要经过最终 journal/owner/witness 检查；非 ready 不调用 mount，锁释放次数正确；observer 失败不能改变权限。

测试失败如实记录：工作区定向组首次为 10 pass / 1 fail。失败在 PC 用例创建第二页面之前，首次 app-ready 的默认 5 秒超时；trace 只有 Vite 连接和首次初始化重载，最终快照仍为“正在准备本地学习数据”，没有 JS 异常。前置就绪等待对齐同文件既有的 15 秒标准，未改占用、数据或恢复断言；随后单独重跑 PC/mobile 两项为 2/2。首次 trace 保存为本机临时文件 `qwerty-phase3a-cold-start-trace.zip`。没有把失败运行隐去或把重跑计作新用例。

共 21 项不同浏览器用例。所有云响应是本地夹具，所有测试数据是合成数据；未做真实 Cloud/Blob、物理手机或发布验收。只对本测试进程设置 NO_PROXY 和独立端口，没有关闭/复用其他任务服务。

## 复现命令

```powershell
node --test tests/cloud/startup-sync-boot.test.mjs tests/cloud/login-event-warning.test.mjs tests/cloud/login-startup-m4.test.mjs tests/cloud/m4-merge-transaction.test.mjs tests/cloud/v4-disjoint-m4-admission.test.mjs
$env:NO_PROXY='127.0.0.1,localhost'
$env:QWERTY_TEST_PORT='53761'
yarn playwright test --config=tests/e2e/startup-sync-regression.config.ts
yarn playwright test --config=tests/e2e/workspace-v4.config.ts --grep 'second actual app tab|mobile account contention|actual app replays pending S1|real app fails closed on corrupt|two Web-Locks-less tabs|copied tab identity|native Web Locks and fallback|crashed V4 Pull|damaged staged V4 fingerprint|S1 boot resumes a complete pending M4|S1 owner mismatch cannot consume'
node scripts/validate-architecture-boundaries.mjs
yarn build
git diff --check
```

## 交付与后续

- 实现提交 `c6838281b598311bbfdd724e95a9533f6202a6eb`。本地验证结束时重新 fetch，origin/product/main 仍为 78d1515，无需合入其他改动。PR 最终 head 的 CI 与外部审查实时结果记录在 PR 描述，不用 PR47 的结果代替本 PR。
- 先复核阶段 3a PR 后决定合并；本轮授权合并的是 PR47。
- 阶段 3b 从最新主线列出 cloud-functions 中 auth/events/V4 的公开入口、依赖与故障语义，再按端口小步拆分。未知写入、单会话、owner、journal、锁和数据格式为不变量，禁止为了接口整齐削弱安全层。
- 阶段 4 继续文档/manifest/触发路径对照与有引用证据的冗余清理；阶段 5 继续历史类型、bundle 和未来授权下的同 SHA 发布候选验收。

剩余风险：现有 index.tsx 仍包含较大的页面编排，云服务端口未拆；147 项类型基线仍未解决。本批清晰化了启动协议，不代表所有传递依赖、历史补丁或发布条件已经收敛。
