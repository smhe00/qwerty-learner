# QWERTY Plus · etest 隔离实网验收清单（2026-10-22）

## 发布判定

本次发布仅限 `product/main` → `edgeone-test` **相同 Commit SHA 快进**；EdgeOne `etest.edgeone.dev` 使用其独立 Blob 空间。绝不推送 `master`，不触碰正式站账号或正式 Blob。

准入证据必须绑定**同一个最终 SHA**：
- Cloud Sync Gate：Node 云端合同测试、Lint、生产构建全部 PASS。
- Pages Regression：已经部署并从 `source-commit.txt` 实际读取到相同 SHA。
- Etest Pilot Admission：只读准入 PASS；主站/etest SHA 分支相同。
- P4b Browser Recovery Gate：本阶段 S1/V4 事务、崩溃回滚及多设备浏览器用例已经通过；本次没有修改 S1 事务恢复入口。

## 实网应验证的能力

1. etest 页面和 `/api/health` 真实响应，`source-commit.txt` 前缀等于目标提交 SHA；检测不同 EdgeOne POP 的短时版本漂移。
2. **匿名、本机账号隔离**：两个独立浏览器 profile 注册/登录、注销、重新登录，不让匿名区混入账户记录。
3. **S2 V4 完整云传输**：Blob 读写、登录后持久化、重复同步幂等、revision 冲突阻断、设备重连及出错后的原始记录恢复。不能因 HTTP 500/超时直接推断提交失败。
4. **M3 事件链 pilot（独立开关）**：仅当 etest 的 `MULTI_DEVICE_AUTH_ENABLED=true`、`MULTI_DEVICE_EVENT_PILOT_ENABLED=true` 并且仓库 Actions 变量 `ETEST_M3_PILOT_ENABLED=true` 时，允许自动触发已有 `etest-m3-pilot-live.yml` 测试。未经确认时不启用这些开关。
5. **M2 checkout 只读存证**：仅有可信的完整 V4 云端版本、已上链设备事件头时，支持服务端设备会话绑定的 checkout 申报/精确读取；不把匹配 SHA 误当成本地 IndexedDB 完整证明。
6. **保守 fail-closed**：同词并发、Review Session 游标分叉、祖先缺失、跨账号、最终一致性观察不完整时不能静默覆盖。两端不同修改的六表归并仍为只读实验，不能宣称多设备自动收敛。

## 不得开放

- 不启用自动三方六表写回和自动 M4 合并；没有经完整证明的共同祖先和 FSRS/Session 冲突仲裁。
- 不在正式 `master` / `q.smhe.cn` 做发布测试。
- 不将只读候选或 Blob list 结果显示为“同步成功”。
- 不以 etest Web UI 正常打开就代替 API、崩溃恢复和独立浏览器 E2E。

## 升级门禁

etest 验证后若真实 EdgeOne 云同步的单端快进、双端并发和断网重试全部通过，再评估受限开启 M3、追加真正六表融合，并在独立审计后讨论正式站发布。未经批准绝不自动升级 `master`。


## M2.15 单端独立 Review 候选 FSRS 完整性门禁

- 在 `v4-disjoint-word-candidate.ts` 中，过去仅有双端同时触碰同一个单词才对 FSRS 调度器重新计算。现对仅一台设备新增的**合格 Review 评级**也重新按完整 WordRecord 事件重放；检查源设备缓存的 reviewCount、lapseCount、cleanStreak、lastOutcome、nextReviewAt、FSRS D/S 与重放结果一致。
- 缺失、过期、伪造的 ReviewWordState 直接阻断候选，禁止将单端缓存状态静默并入完整 V4。不可验证的旧学习历史保持保守阻断，不把这种拒绝解释成用户记录丢失。
- 保留既有的 UUID 去重、数字 WordRecord 主键重映射和 FSRS shadow sourceRecordId 关联修正；测试补入真实独立 Good、交换设备顺序确定性、过期/伪造状态拒绝。
- 此更改仍**仅为只读候选与隔离测试**：`publishReady:false`、`convergenceComplete:false`，不开放 M4 自动应用，不写回正式 Blob；需 CI 和 etest 验证后再评估。
