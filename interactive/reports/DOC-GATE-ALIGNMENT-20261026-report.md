---
protocol_version: '1.1'
task_id: DOC-GATE-ALIGNMENT-20261026
status: REVIEW
executor: Codex
target_branch: codex/docs-gate-alignment-20261026
claim_base_commit: 875c82a2c404b441dc582aa3a018288edeed1f9a
integrated_upstream: a82f9d95b1fb4c3dc24d77a4951d234fd43d9955
release_to_master: false
---

# 文档与验证映射整改报告

## 范围与结论

用户批准处理基线 `875c82a2` 上的只读审计发现，按已说明的文档优先范围执行。云相关代码修改继续停止；#48/#49 保持关闭，已合并 #46/#47 原样保留。变更只含文档与验证 JSON 索引，CI 触发调整另行安排。

## 审计发现与处理

| 发现 | 本批处理 |
| --- | --- |
| 主线整改计划仍将 2b 和云重构列为后续 | 更新合并/取消状态及固定 SHA 证据链接，不将关闭的旧分支重新带入主线 |
| 旧部署说明建议把 Maker 生产绑定 main、将 master 当静态上游 | 添加历史定位和当前 AGENTS 链接，明确当前分支角色；保留历史试验记录 |
| 同步正式规范仍描述旧 completion-only 单向上传 | 对照现有 LearnResultScreen/learn-block-sync，描述受保护 V4 handoff、默认开关、失败保护与证据边界 |
| 回归清单引用已不存在的 singleton 测试标题 | 保留 REG-20261004-LEARN-SINGLETON-STALL，登记生产 19-of-20 边界、连续练习预防、generic oracle 故障检测及原 F4 无进展检测 |
| TLC bridge 与 cloud browser 测试归属错误 | TLC 模型归 TLA Gate，bridge 归 Review Gate；当前完成流程、backend、实际 etest、旧 V3 浏览器分开映射 |
| Verification Gate 不监听被引用测试变化，且没有 PR 入口 | 如实记录未修复的触发缺口与本地检查步骤；不改变 workflow/脚本或声称已强制执行 |

旧 singleton 断言已因连续练习语义变为“即使使用 admitted-based quota 也不再形成循环”。不能仅把失效目录换成一个语义不同的标题。本批组合现有生产防回归与故障检测用例，保留原 F4 断言；不修改任何测试正文。

旧 `cloud-sync-live.spec.ts` 仍等待历史 V3 capability。它保留为历史兼容映射，不作为当前 V4 验收依据。当前实网完成证据入口是 `etest-learn-completion.yml`，本次只登记而不执行。映射校验器仍只验证 ID、路径、规范与标题存在；真实 workflow/config 对应关系由本批定向检查，尚无新增自动强制检查。

## 验证

| 检查 | 实际结果 |
| --- | --- |
| `node scripts/validate-gate-manifest.mjs` | PASS：12 个门禁、24 项契约；8 项历史回归共 19 个标题引用有效。原失效项已修复 |
| 现有 singleton/F4 定向模拟回归 | PASS 4/4，0 skipped；Node v22.22.0，本地合成数据。两个既有 TS 测试文件用 esbuild 编译到临时目录，按四个完整标题过滤执行，无测试正文变更 |
| 调整过的执行映射 | PASS：6 项契约的 16 个输入逐项核对实际 workflow 命令、package glob 或 Playwright config 的 testMatch；`--list` 不计为实际执行 |
| 相对文档链接 | PASS：10 个链接目标存在；GitHub 固定提交链接保留历史成果，不引用未合并文件的主线路径 |
| 差异范围与格式 | PASS：只含 6 份 Markdown 和 2 份 JSON；`git diff --check` 通过。src、cloud-functions、测试正文、scripts、workflow、依赖及 CURRENT_TASK 与集成上游一致 |

四个定向用例为：历史 19-of-20 生产边界稳定、admitted-based accounting 下连续练习不循环、generic oracle 能发现重复 singleton 故障、原 F4 成功作答无投影/无状态进展检测。它们分别覆盖防回归和检测能力，未把当前生产场景改回旧故障行为。

本地原始 TAP 证据：`C:/Users/peter/AppData/Local/Temp/qwerty-doc-gate-zQMUIR/results.txt`。该路径是可清理的本机临时产物，持久交付以本报告结果及既有测试源码为准。复现时将 `tests/simulation/system-driver.test.ts` 与 `system-oracle.test.ts` 用 esbuild 的 Node20/ESM bundle 编译到独立临时目录，再用 Node `--test --test-name-pattern` 选择回归清单中该 ID 的四个完整标题；无需任何网络、浏览器或账号。

产品构建、完整应用回归、TLC、真实云和物理设备均 NOT_RUN；没有触发部署、创建账号或操作用户数据。不把本地检查记为 CI 或发布验收通过，也未重新统计历史全仓类型错误。

## 隔离与后续

CURRENT_TASK 属于 CIRCLE-BLOB-SEVEN-DAY-20261026，本任务不改其任务、报告、指针或工作区。提交前 fetch 发现主线前进到 `a82f9d95b1fb4c3dc24d77a4951d234fd43d9955`，包含另一任务的 Circle 源码与报告；在本分支快进纳入，无冲突。新增 Circle 路径不触及本次文档、映射选中的实现/测试或对应工作流，原四项模拟证据仍适用；集成后清单校验再次通过。其他任务的测试/发布结果不计为本任务验证。

独立文档分支交付 PR，不直接合并或发布。后续优先单独处理门禁触发覆盖和映射校验强度；不得据此重启云同步运行时重构。
