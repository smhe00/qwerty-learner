# Qwerty 云账号与同步架构

## 1. 定位

本模块给 Qwerty Learner 增加可选的“账号 + 云存储 + 跨设备同步”能力，同时保持原项目 local-first：

- 未登录：行为与 upstream 一致，只使用浏览器 IndexedDB。
- 已登录：仍以 IndexedDB 为工作数据库，云端只保存同步快照。
- Review、Typing、词典格式不依赖云平台。

因此云能力属于独立平台层，不属于 `src/review/`。

## 2. 代码边界

```text
backend/
  core.mjs                    认证、Session、revision、冲突协议
  self-test.mjs               平台无关的完整契约测试
  storage/edgeone-blob.mjs    EdgeOne Blob 适配器

cloud-functions/api/[[default]].js
                              EdgeOne HTTP 适配器

src/
                              当前阶段不修改
```

核心后端只依赖一个 storage contract。以后 Blob 可替换为 S3/COS/Gitee，而前端 API 不变。

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

开发环境可临时启用：

```text
POST /api/__test/full
```

## 4. Blob 数据模型

命名空间默认：`qwerty-data`。

```text
accounts/
  <SHA256(normalized_username)>/
    identity.json
    auth/
      000000000002.json
      000000000003.json

users/
  <userId>/
    revisions/
      000000000001.json
      000000000002.json
      ...
```

`identity.json` 是不可变账号身份，并包含初始 auth version 1。

密码修改不覆盖旧对象，而是创建新的 auth version。Session token 带 auth version，因此密码修改后旧 Session 自动失效。

同步快照同样采用不可变 revision。上传必须携带 `baseRevision`，只有创建 `baseRevision + 1` 成功才算提交。底层使用 Blob `onlyIfNew`，从而避免两台设备同时覆盖同一 revision。

## 5. 一致性

账号读取、auth version 查询、revision 查询全部使用 Blob strong consistency。

这类数据属于状态机，不使用默认最终一致缓存。

## 6. 数据职责

```text
IndexedDB
  = 用户实时工作数据库

EdgeOne Blob
  = 账号 + 跨设备同步快照

ReviewWordState
  = IndexedDB 内可重建派生状态

GitHub
  = 源码、测试、文档、部署配置
```

云端 payload 对后端完全 opaque。后端不知道 WordRecord、Review、Telemetry 等业务结构。

未来客户端负责：

```text
IndexedDB export
→ gzip
→ AES-GCM
→ Base64
→ PUT /api/sync
```

## 7. Upstream 隔离原则

1. 不要求登录才能学习。
2. 不修改词典 JSON。
3. 不把 EdgeOne SDK 引入 `src/review/` 或 Typing。
4. 前端未来只在 `src/sync/` 和极小设置入口接入。
5. 云功能保持 fork-only，不阻碍 Review 模块单独向 upstream 提 PR。
