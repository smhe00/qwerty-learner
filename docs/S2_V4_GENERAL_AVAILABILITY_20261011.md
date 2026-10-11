# Qwerty Plus — S2 Backup V4 全账号开放（GA）

发布日期：待本变更通过 Gate 并在 Maker Production 实际部署后确认。

## 决议

**所有拥有有效会话的普通账号均可使用 V4 云端同步。**不再配置、校验或维护 `S2_SYNC_WRITE_ACCOUNT_IDS`，即使 Maker 上仍遗留该变量也不会影响授权；可安全移除旧变量，无需再为每个账号重新部署。

* `PUT /api/sync/v2`：Bearer 有效、账号仍有效且服务端确认会话后，允许尝试 V4 上传；服务端继续校验当前账号不可变 userId、完整 V4 gzip、SHA/逻辑指纹、baseRevision/CAS。
* `PUT /api/sync/v2/recovery`：同样对所有有效账号开放，但只允许附带**当前云端 revision/原始 SHA/账号确认/明确恢复模式**的显式恢复，不是普通同步的自动降级策略。
* `GET /api/sync/v2/meta`、`GET /api/sync/v2` 仍强制 Bearer，不暴露其他账号数据。
* 可选 Maker **运行时**紧急停写环境变量 `S2_SYNC_WRITES_DISABLED=true`：统一返回 `503 s2_writes_temporarily_disabled`，关闭两个 V4 PUT；默认不设置或设 `false` 时所有有效账号均可写。该开关不是用户名白名单，不能用来跳过身份校验。
* 历史 `/api/sync` 仍与 V4 接口隔离，并且**不得覆盖已经拥有 V4 云端数据的账号**。

## V3 旧数据处理（用户明确不做自动迁移）

* 新注册账号、从未同步过的账号：如果云端 revision=0，客户端可正常首次 Push V4。
* 云端已经是 V4：正常 Sync 的 No-op、Pull 或 CAS Push。
* 云端仍是 V3/V1：**普通 Sync 必须返回 `remote-format-unsupported`，不自动转换/覆盖/合并；服务端普通 V4 PUT 仍拒绝 `409 sync_migration_required`。**
* 用户若要迁移，使用现有 `高级恢复（冲突 / V3 数据迁移）`，先下载两端原始完整备份，再明确决定保留方向并核对不可变 userId、原 SHA 与云端 revision。历史 V3 不会因此被静默删除。
* 如果 V4 文件来自另一个账号，使用正式“导入完整备份 V4（支持跨账号）”在本地明确确认重绑定，然后独立选择首次云端同步，绝不复用旧账号的登录权限或同步基线。

## Gate（严禁以生产用户数据做测试）

1. 全账号路由测试：两个不同不可变 userId 即使未配置白名单也能访问 V4 Put/Recovery；失效、撤销、缺失 Token 在 JSON 解析前拒绝；紧急停写拒绝。
2. 完整 Backend Core 测试：新账号 V4 首次写入、旧 V3 云端隐式升级被拒绝、伪造账号所有权/逻辑指纹错误被拒绝、同一 revision 多端竞争只能成功一次、旧 V1 不得覆盖已有 V4。
3. Cloud Sync Gate：Backend 单元/集成、ESLint、前端构建 PASS。
4. S1/S2 浏览器 Gate：工作区隔离、同步基线、Pull journal、手动迁移保持原有安全性。
5. `master` 只在 Gate 全通过后快进一次；Maker 构建成本有限。部署后检查公开 `/api/health` 的 `backup-v4-authenticated-write-ga` capability；对隔离临时账号执行实网 PUT，并清理账号，**不得利用真实账号做写入测试**。

> 本次 GA 不是迁移存量账号的授权；只开放 API 写权限。服务端数据归属、CAS 和手动迁移门槛不变。
