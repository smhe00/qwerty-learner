# Qwerty 云账号与同步架构

> 持续开发状态与恢复步骤见 `docs/CLOUD_SYNC_DEVELOPMENT_PLAN.md`。

## 1. 定位

本模块给 Qwerty Learner 增加可选的“账号 + 云存储 + 跨设备同步”能力，同时保持原项目 local-first：

- 未登录：行为与 upstream 一致，只使用浏览器 IndexedDB。
- 已登录：IndexedDB 仍是工作数据库，EdgeOne Blob 只承担账号状态和同步快照。
- 网络不可用时不得影响正常学习。
- Review、Typing、词典格式不依赖云平台。

当前阶段不修改 `src/`。

## 2. 代码边界

```text
cloud-functions/
  _shared/
    core.js                    平台无关：认证、Session、revision、冲突协议
    self-test.js               本地/GitHub 后端完整契约测试
    storage/edgeone-blob.js    EdgeOne Blob 适配器
  api/[[default]].js           EdgeOne HTTP 入口

tests/cloud/
  backend-core.test.mjs        内存 Storage 契约测试

src/
                              当前阶段不修改
```

核心逻辑放在 `cloud-functions/_shared/` 以符合 EdgeOne Functions 的辅助模块打包边界，但 `core.js` 本身不依赖 EdgeOne SDK，只依赖 storage contract。

## 3. API v1

```text
GET  /api/health

POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/change-password

GET  /api/sync/meta
GET  /api/sync
PUT  /api/sync
```

没有公网测试接口。

## 4. 单账号单在线会话

V1 不使用 JWT，也不需要 `APP_SESSION_SECRET`。

登录成功产生 256-bit 随机 session secret，token 形式：

```text
qs1.<usernameHash>.<randomSecretBase64Url>
```

服务端只保存：

```text
SHA256(fullToken)
```

不保存原始 token。

每次登录创建新的 immutable session version：

```text
accounts/<usernameHash>/sessions/00000000000N.json
```

最大 version 是唯一有效 session。新登录完成后，旧设备的 token 在下一次请求时得到 `401 session_revoked`。

Session 读取使用 Blob strong consistency；session version 写入使用 `onlyIfNew`。

若两个登录并发竞争同一 version，失败方重新读取最新 session 并创建下一 version，因此最终仍只有最大 version 有效。

## 5. 密码

密码使用：

```text
scrypt
random 16-byte salt
64-byte derived key
N=16384
r=8
p=1
```

密码修改创建新的 immutable auth version，同时创建新的 session version，因此修改密码后旧 session 失效。

## 6. Blob 数据模型

命名空间默认：`qwerty-data`。

```text
accounts/
  <SHA256(normalized_username)>/
    identity.json
    auth/
      000000000002.json
      000000000003.json
      ...
    sessions/
      000000000002.json
      000000000003.json
      ...

users/
  <userId>/
    revisions/
      000000000001.json
      000000000002.json
      ...
```

`identity.json` 包含 immutable 身份、初始 auth version 1 和初始 session version 1。

所有状态机读取使用 strong consistency。

## 7. 为什么单会话后仍保留 revision

单会话消除了正常的多设备同时写，但仍可能有：

- 同一个浏览器多个 tab；
- HTTP retry；
- 请求乱序；
- stale client state。

因此同步仍采用：

```text
baseRevision == remoteRevision
       ↓
create remoteRevision + 1
       ↓
Blob onlyIfNew
```

若 revision 已存在，则返回 `409 sync_conflict`。

这比覆盖一个 `snapshot.json` 更安全，而且实现成本很低。

## 8. Snapshot 保留策略

revision 编号单调增长且永不复用，但 Blob 不永久保存所有完整 snapshot。

V1 固定保留最近 **3 个**完整 revision：

```text
.../000000000128.json
.../000000000129.json
.../000000000130.json
```

成功写入 131 后，删除 128：

```text
.../000000000129.json
.../000000000130.json
.../000000000131.json
```

这样保留并发保护和短窗口恢复能力，同时限制重复完整 snapshot 的空间占用。

retention 清理属于维护动作：新 revision 一旦已通过 `onlyIfNew` 成功持久化，即使删除旧版本失败，也不能把本次同步返回成失败，否则客户端可能重试已经成功的提交。

## 9. 离线分叉

单 active session 不等于永远没有数据分叉。

例如旧设备离线产生未同步数据，而另一设备登录后继续推进云端。

V1 不做自动 record-level merge。

未来前端检测：

```text
localDirty = true
AND
localBaseRevision != remoteRevision
```

时停止自动同步，让用户明确选择保留本地/导出备份或采用云端版本。

## 10. 数据职责

```text
IndexedDB
  = 实时工作数据库

EdgeOne Blob
  = 账号状态 + session 状态 + 同步快照

GitHub
  = 源码 + 测试 + 文档 + 部署配置
```

同步 payload 对后端完全 opaque。

未来客户端负责：

```text
IndexedDB export
→ gzip
→ AES-GCM
→ Base64
→ PUT /api/sync
```

## 11. 运行配置

V1 无需应用 Secret：

```text
SESSION_TTL_SECONDS=604800
MAX_SYNC_BYTES=4194304
BLOB_STORE_NAME=qwerty-data
CORS_ORIGIN=same-origin
```

默认只允许浏览器同源调用。若未来拆分前后端域名，可显式配置逗号分隔的允许 Origin；仅在明确需要时才使用 `*`。

## 12. Upstream 隔离原则

1. 不要求登录才能学习。
2. 不修改词典 JSON。
3. 不把 EdgeOne SDK 引入 `src/review/` 或 Typing。
4. 后续前端只在 `src/sync/` 和极小设置入口接入。
5. 云功能保持 fork-only，不阻碍 Review 模块单独向 upstream 提 PR。


## 13. Auth / Session 保留策略

初始 auth/session version 1 仍内嵌在 immutable `identity.json`。

额外的版本对象采用有限保留：

```text
auth versions:     latest 2
session versions:  latest 3
snapshot revisions latest 3
```

版本号继续单调增加，删除旧对象不会复用版本号。

新 auth/session 对象一旦通过 `onlyIfNew` 成功提交，retention cleanup 只是维护操作。cleanup 失败不会把已经成功的登录、改密或同步操作改判成失败。

该策略同时限制 Blob 空间增长，并让 `getLatestAuth/getLatestSession` 的 version listing 长期保持在很小的集合内，降低分页风险。
