# etest · V4 跨账号备份恢复 / 双端覆盖决策全分支验证

日期：2026-10-15。环境：`https://etest.edgeone.dev/`，实网站点提交 `e54720945961331f3d3676556378392614fd3782`。
测试工作区：`qa/etest-cross-account-backup-matrix-20261015`，**仅用于测试；没有部署 Maker，没有修改 master/edgeone-test**。

## 证据

- **实网全链路**： [GitHub Actions run 38671175159](https://github.com/smhe00/qwerty-learner/actions/runs/38671175159) — PASS。4 个临时 S1 云账号 + 独立 Chromium contexts；真实 Learn wordRecords；真实标准 V4 本地/云端 gzip；真实 Commit/Blob/revision；1 项完整场景测试，12 个业务检查点，3.3 分钟；所有 4 个账号 DELETE PASS。
- **决策与事务**：同一 run 的 `decision-and-local-contract` — 46/46 PASS（包含 2 来源 × 6 状态表及异账号 baseline 拦截）。
- **浏览器恢复失败注入**：同一 run 的 `browser-all-branch-safety` — 11/11 PASS（含取消、错误 ID、双备份确认、云端变化、旧 revision、HTTP 500 未提交/已提交两种结果、恢复日志中断等）。
- 用例源码：`tests/e2e/etest-cross-account-backup-matrix.spec.ts`、`tests/cloud/sync-v2-policy.test.mjs`、`tests/e2e/workspace-v4-manual-import.spec.ts`、`tests/e2e/workspace-v4-s2-recovery.spec.ts`。

## 业务路径与观测

| 路径 | 业务断言 | 实网 |
|---|---|---|
| A → 本地 Backup V4 | A 两条真实 Learn 记录，完整 V4 原始数据导出 | PASS |
| A 云 V4 → gzip 下载 | A 云端 revision=1，V4 结构验证 | PASS |
| A 本地 V4 → 新账号 B → Sync | B 本地 2 条，云端原本无数据；随后 Push 到 B revision=1 | PASS |
| B 再导入相同本地 V4 → Sync | Noop，没有制造新 revision | PASS |
| A 云端 V4 → 新账号 C → Sync | C 本地 2 条，云端原本无数据；Push 到 C revision=1 | PASS |
| C 再导入相同云 V4 → Sync | Noop，云端 revision 不变 | PASS |
| D 初始独立记录 | D 自己学习一词，云端 revision=1 | PASS |
| A 本地 V4 → D，当前云已有不同数据 | 导入不改 D 云端；普通 Sync 告知冲突，双端均保留 | PASS |
| D 跨账号导入最终确认取消 | 没有误删学习记录或覆盖云端 | PASS |
| D 高级恢复操作取消 | 云端 revision/数据不变，用户必须再次明确确认 | PASS |
| D 保留云端 | D 本机从 2 条恢复为云端 1 条，revision 仍为 1，下一次 Sync Noop | PASS |
| A 云导出的 V4 → D，保留本地 | D 2 条本地记录，显式 CAS 覆盖 D 云端到 revision=2，下一次 Sync Noop | PASS |
| 本地 D 的 V4 → B，保留本地 | B 从 2 条变 1 条，明确确认后 B 云端 revision=2，下一次 Sync Noop | PASS |
| 云导出的 D V4 → C，保留云端 | C 本机恢复原 2 条，云端保持 revision=1，下一次 Sync Noop | PASS |
| 账号来源隔离 | 全过程 A 自己的 2 条记录、原不可变 ID 均未改变 | PASS |
| 测试现场清理 | 4 个临时身份依次 DELETE 成功 | PASS |

说明：上表包含 12 个运行时摘要检查点及其子断言，不是声称每一表格行对应一个独立 Playwright `test()`。运行时摘要以 `CROSS_ACCOUNT_REDACTED_CHECKPOINTS` 保存；不输出账号凭据和学习明文。

## 数据归属和选择规则（断言）

1. 跨账号 Backup V4 的原始 owner 只是来源信息，不是目标账号的登录凭据。接收账号必须明确授权并输入**目标**不可变 ID。
2. 导入只替换当前本地账号工作区，完成前保存当前本地完整备份；不静默改写目标云端，且目标旧 sync baseline 清空。
3. 目标云端不存在：有内容的导入后本地可 CAS Push；存在且逻辑 fingerprint 一致：metadata-only Noop；存在且 fingerprint 不同：普通 Sync 必须返回 conflict，不能自动 Pull/Push。
4. 高级恢复只能在双方备份已实际下载、两份保存确认、方向与账号 ID 完整选择之后进行。用户取消必须不产生云端写入。
5. keep-local 通过云端 revision CAS 增加版本；keep-cloud 先验证固定远端快照、记录恢复日志、在新启动下恢复本机、重设 baseline。两个方向之后的普通同步应收敛为 Noop。

## 明确限制

- 本次跨账号全路径使用正常大小的真实 V4 学习备份；**没有**对 16MiB 上限、不同地区 EdgeOne POP 同步传播、两个真实设备同时编辑/merge 进行穷尽实测。这些属于额外的大数据/并发/传输压力 Gate，不应假称已覆盖。
- 云端故障（HTTP 500、旧 revision、恢复日志中断）的各分支已在独立 Chromium 注入测试中通过，**不是**声称每个 500 都已在真实 etest 中复现。
- 未执行任何对生产账号的操作；禁止因此自动发布 master。
