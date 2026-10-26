# 登录恢复状态机：第一轮有界审计

审计对象是 etest 实际运行的 1030f9cd809858e7b14ea9132ae3c2508ef51b04。生产 master 仍为 9620e33c，product/main 仍为 db8f7b76。没有修改产品运行时代码、推送部署分支或重放未知结果的云写入。

结论：存在已复现的多余恢复分支，以及缺少整次启动等待上限的组合问题。慢网络足以暴露后者，甚至不需要 HTTP503。原 CI 40253418650 的 180 秒失败仍不能宣布根因完全闭环：原日志没有逐请求耗时和完整页面状态，本轮实网诊断没有再次超时。

## 1. 已证实：本地候选未变仍进入恢复事务

代码链条：

- m4-merge-journal.ts finalize(apply) 原子删除 M4 journal 和旧 S2 baseline，保留 rollback。这一步正确：本地 M4 完成不能冒充云端全 V4 收敛。
- 下一文档启动，v2-policy.ts 把 baseline=null、非空本地与较小云端不同判为 conflict。
- v2-manual-executor.ts 自动融合校验候选、归档、执行一次 CAS，并验证服务端 revision、logical fingerprint 和 payload SHA。
- 即使候选指纹等于当前本地指纹，且云端成功确认同一份内容，该分支仍无条件 journal.stage，返回 pull-reload-required。
- workspace-bootstrap.ts / index.tsx 随后要求“stage 后刷新 → 恢复同一份本地快照 → 再刷新”。这是额外两次刷新，不是已经证实的无限循环。

真实 Chrome / IndexedDB 审计夹具使用实际 capture、六表 merger、M4 transaction、真实 M4/Pull journal、S2 executor 和 recovery kernel。网络端口是明确标注的合成服务，没有访问公共 API。

结果：

- M4 完整 capture/stage/restore/verify/seal/finalize/complete。
- M4 journal 已清除、旧 baseline 已清除，本地等于候选。
- 再次使用真实 merger 得到 candidateEqualsLocal=true。
- 一次云 CAS 确认后 cloudEqualsLive=true，仍然 pull-reload-required。
- durable journal 中的 snapshot 与 live fingerprint 相同。
- 实际恢复后下一次 S2 为 noop，本地未改变。

这证明缺少“候选未改动本地，仅完成云端追平”的结束分支。它增加 I/O 和启动成本；本轮没有证明数据丢失。

## 2. 已证实：每请求超时不等于整次启动有界

api.ts 给 V4 请求 90 秒、M3 请求 30 秒，二进制分片各有 90 秒。guarded bootstrap 串行等待 S2、M3 publication、M4 observe/witness，且恢复刷新后重新开始。未发现覆盖整个登录与全部恢复文档的总预算；syncing UI 没有安全降级入口。

tests/cloud/login-boot-bounded-audit.mjs 对一个实际可达的后 M4 路径枚举有限时序：

1. S2 meta；
2. 一片 V4 的 manifest；
3. part；
4. meta recheck；
5. CAS 的成功回执；
6. stage/recover 两次额外刷新后的 S2 meta；
7. 一批新 M3 事件 POST；
8. 精确 GET 回读；
9. M4 observe。

每步成功耗时从 {1,10,22,29} 秒取值，共 262144 个时序；28565 个在最终 witness 之前就超过 180 秒。这个数量只是有限组合覆盖，绝不是线上失败概率。

具体反例：九个请求均成功、每个 22 秒，且均低于各自超时；第八步结束已是 176 秒，第九步到 198 秒才结束，页面仍未进入最终 witness/mount。CPU、Dexie、文档加载、可选 checkout 和最终 witness 的耗时全部按零计算，所以这是该模型的下界，不是线上测得的 198 秒。

此模型只覆盖声明的可达路径及延时集合，不是 TLA+/全程序模型证明，也不证明持续故障下最终一定可用。

## 3. 已证实的放大因素：可选声明阻塞关键路径

m3-publication-browser.ts 已取得 published 结果后，仍 await tryDeclareCheckoutAfterPublication，再返回。后者可等待 pinned ancestor、cloud meta、verify-set、checkout POST 和 exact GET。它不授权 V4 恢复，也不提供“全端同步完成”结论，却在 mount 前被同步等待。

受控 deferred promise 验证：事件已发布并清空待发队列，声明未返回时 followup 仍未结束；声明失败后返回 blocked。不是在此断言 API 会无限等待，实际请求仍有单次超时。

边界：M4 清除 baseline 后，旧 pin 可能立即被拒绝，根本不发这组网络请求。只有 S2 恢复建立匹配 baseline/pin 后等满足条件的路径才会增加等待。原 CI 的最后 trace 已出现 published，说明当时的 optional checkout 已返回；它最多解释此前累计耗时，不能被当作最后卡住的请求。

## 4. 网络故障边界对照

执行实际 S2 executor 和真实 merger，使用可控端口覆盖一个正常控制和 12 个故障分支：

metadata offline、download timeout、损坏下载、archive quota、远端 revision 前移、明确 precommit503、已提交但 ACK 丢失、已提交但 ACK 错误、提交前 owner 变化、提交后 owner 变化、stage 提交前失败、stage 完成后的调用方中断。

所有分支验证：单次执行至多一个 CAS；上传前已有原件归档；未验证成功前不推进 baseline；执行器不直接覆盖工作库；已提交的 journal 保留。ACK 丢失/错误后的新调用通过精确云元数据走 noop，没有第二次上传。

限制：故障端口是抽象边界，不等于真实浏览器在每个位置都能产生同一种异常。特别是 stage-after-commit 是“提交后调用方中断”的模拟，不声称已复现 IndexedDB commit 后 promise 自发拒绝，也没有据此声称 boot wrapper 发生越权 mount。此轮未穷举并发账号切换、BFCache、IDB 锁和崩溃的全部交错。

## 5. 本轮实网路径诊断

仍用 1030 runtime；诊断测试位于独立审计分支，因此不能充当同 SHA 发布验收。只增加只读时序收集，并在三设备恢复联网后等待 C 的正常后台 M3 publication 被诊断记录确认，再执行原来的顺序重登。不点 Sync、不强制导入、不增加人工写重试，180 秒 mount 断言不变。

结果：1/1 PASS，3.2 分钟，最终三端 [3,3,3]、所有 journal pending=false，DELETE cleanup HTTP200。九次登录耗时分别为 5723、5846、5827、34991、25765、24029、20870、14821、5530 毫秒。

关键证据是 A 的第一次重登实际发生 M4 adopted1：
- 02:07:11.499Z M4 transaction 完成，耗时 41.2ms。
- 后续 S2 automatic merge/build/upload/stage，account-sync 耗时 7990.9ms。
- 实际两次恢复导航后再检查 S2，再等待 M3 publication 7935.6ms。
- 整次约 35 秒，最终进入页面。

这是原先较快的“直接 S2 收敛、无 M4 adoption”诊断没覆盖到的分支。本轮真实链路支持启动串联路径可达，但日志刻意不导出快照/指纹，因此不能仅凭实网行数声称此次 candidate==local；该相等反例由第 1 节真实 Dexie 本地审计单独证明。

保留一条 verify-set POST 的 503/request_body_unavailable，未手动重放，后续重新登录最终正常。没有复现原 CI 的 180 秒卡住，不以这次通过覆盖旧失败。

## 6. 对照与修复顺序

建议首先实现且单独验证“小候选不改本地”的收敛分支：保持完整合并审计/归档/CAS/双哈希验证，在所有权与本地快照再次确认后，仅原子推进 baseline；不建立重复 Pull、不重新导入同一数据。云提交回执未知仍保持 pending，下次只读核对；实际改动本地的候选仍必须走完整 journal/recovery。

随后给整次 boot 增加跨 reload 的 budget/phase 状态，明确区分：

| 状态 | 超出网络预算后的允许行为 |
| --- | --- |
| 本地完整、已封存、无待恢复事务 | 保留“待同步”，结束网络准备后进入本地学习 |
| 远端提交未知，但本地未改动 | 不重放写入；保留待核对状态 |
| 已有 Pull/M4 journal 或本地部分恢复 | 必须完成恢复或显示明确恢复受阻，禁止直接 mount |
| 所有权/认证已改变 | 停止旧流程，不让迟到响应推进新账号状态 |

必须真正停止/收束未完成的操作。不能简单 Promise.race 超时后 mount，因为后台任务可能仍在写数据库。可选 checkout 应移出首屏关键等待链路，继续检查 owner/auth，不让它产生同步完成提示。

需要补全同一 bootAttemptId 跨文档的阶段日志、在途请求年龄、已确认云 revision（脱敏类别）、未完成 journal 类型和首屏状态；保留原 180 秒失败点。阶段变化应比“看到三条记录”更强。

运行时修复后重新冻结候选，做确定性慢网/断网/已提交丢 ACK/恢复中断/所有权切换的组合回归，再跑同 SHA 三设备、Pages、Cloud/Blob、release-ready 及生产验收。不要直接把当前独立发布清单允许的 3 个环境文件扩成未审计运行时范围。

## 7. 可复现文件和验证

- tests/e2e/login-boot-formal-audit.config.ts：本地真实 Chrome/Dexie，1/1 PASS；定向 ESLint 0 错误。
- tests/e2e/login-boot-formal-audit-harness.ts：实际执行器与状态机断点。
- tests/cloud/login-boot-bounded-audit.mjs：262144 个有限延时组合，成功输出反例。
- tests/e2e/login-boot-live-diagnostic.config.ts：实际 etest 独立诊断，1/1 PASS；与原发布 gate 分离。
- evidence/LOGIN-BOOT-FORMAL-AUDIT-20261026/actual-kernel-proof.json
- evidence/LOGIN-BOOT-FORMAL-AUDIT-20261026/bounded-timing-proof.json
- evidence/LOGIN-BOOT-FORMAL-AUDIT-20261026/live-diagnostic-summary.json
- evidence/LOGIN-BOOT-FORMAL-AUDIT-20261026/original-ci-failure.json

Windows 本地跑 Vite/Playwright 时进程内设置 NO_PROXY=127.0.0.1,localhost，并设置一个空闲 QWERTY_TEST_PORT；保留外网代理。第一版合成上传回执错误地重新序列化了预制 candidate 的 metadata.createdAt，造成 payload SHA 不符；已修正为按实际上传字节解压确认再回执。此夹具错误未计作产品缺陷。

下一执行者应从本报告继续，不重复“把 180 秒加长”。本轮审计已完成，原发布任务仍 PARTIAL/BLOCKED_ON_NON503_BOOT；master、etest、product/main 保持上述 SHA，qwerty 等待自动跟进保持暂停。
