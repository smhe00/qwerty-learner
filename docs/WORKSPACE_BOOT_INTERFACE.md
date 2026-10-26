# 工作区启动接口

阶段 3a 契约。`prepareGuardedWorkspaceBoot` 在 React、Jotai 和工作数据库 writer 初始化前执行，返回 `WorkspaceBootOutcome`；`mountGuardedWorkspaceApp` 仅在 ready 时调用挂载回调，也返回同一结果类型。类型定义位于 `src/sync/workspace-boot-outcome.ts`。

| kind | 携带内容 | 调用者行为与锁归属 |
| --- | --- | --- |
| ready | boot：mode、registry、passiveAccountReturn、release | 安全检查已通过；调用者接管持锁能力，才可导入/挂载应用 |
| reload-required | reason：恢复完成来源或 s2-pull-staged | 已释放本次锁，不可在当前 JS realm 挂载；必须重载 |
| occupied | 原始 error | 未取得 writer 权限；PC 保持关闭其他页后重试，mobile/account 保持有界等待及同页面重试 |
| blocked | reason：safety-check 或 m4-recovery-required；原始 error | 已取得的本次锁已释放；禁止挂载，不清数据，不自动重放未知写入 |

`ready` 是本地启动安全检查结论，不是全账号同步或多设备收敛结论。`GuardedWorkspaceBoot` 只表示成功后的持锁能力；消费它的备份、恢复、清理、会话撤销界面直接导入契约类型，不依赖启动实现。

## 恢复与重载

| reason | 到达结果前已完成的工作 |
| --- | --- |
| s1-recovered | 原 S1 journal replay、身份意图协调、witness reseal |
| s2-pull-staged | 远端完整数据已验证并暂存，但尚待下一页面恢复；不得作为完成提示 |
| s2-pull-recovered | 原 Pull 恢复、witness 和基线最终提交已完成 |
| manual-v4-recovered | 原手动 V4 导入 journal 恢复完成 |
| m4-recovered | 原 pending M4 完成，或经验证的前缀 adoption 完成 |

恢复函数、执行顺序、持久 journal、完整 V4 校验、预算跨页继承及用户提示保持原行为。恢复成功仍必须换到全新 JS realm，丢弃恢复时加载的旧模块缓存。`index.tsx` 仅依据 kind/reason 选择动作；英文错误消息不再具有控制含义。

## 可识别失败

`workspace-errors.ts` 仅提供两个由所属边界创建的本地错误类型：

- `WorkspaceWriterOccupiedError`：在 native lock、IDB lease 或复制标签页 challenge 确认占用时产生。锁的 TTL、挑战、事务选举、续租、释放和 fallback 算法保持原样。等待重试只识别此类型，绝不把占用转成绕过 native owner 的 fallback。
- `M4RecoveryRequiredError`：M4 已 stage 后的失败，保留原 cause 和 journal。适配器及启动层使用类型继续传递，不将其吞成普通网络延期；最终结果为 blocked，不是“已恢复”。

普通 Error 即使包含旧版“reload required”或“Another tab owns”文本，也不能获得重载/占用动作。没有 journal 的普通网络失败仍可延期；随后必须通过原最终 journal、generation、owner、token、witness 检查才能返回 ready。

## 测试与边界

- `tests/cloud/startup-sync-boot.test.mjs` 直接断言结果矩阵、挂载次数、锁释放次数、预算继承、passive return、错误消息变更与伪装、journal 保留。
- `tests/cloud/login-event-warning.test.mjs` / `login-startup-m4.test.mjs` 保留原始事件不修复/不重识别、未知发布不重试和实际 M4 适配器行为。
- M4 transaction/admission 契约覆盖 stage、restore、readback、seal、finalize 和 rollback。
- 真实浏览器覆盖账号返回、丢失 ACK、S1/S2/M4 journal、多标签 native/fallback 选举、复制 tab 身份及 PC/mobile 入口。
- 既有 browser harness 使用 `tests/e2e/boot-outcome-fixture.ts` 把结果转成旧断言的诊断文本，以保留历史安全断言。此兼容仅在测试夹具中；生产不存在旧异常 API 或按该文本路由的入口。

本模块没有替换 S1/S2/M3/M4 协议，没有修改账号授权、单会话、数据库 schema、写入身份或远端 transport。阶段 3b 的云服务端口仍待后续独立 PR；此文档也不表示全仓启动/UI/同步大模块已全部拆完。
