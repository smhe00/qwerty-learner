# Qwerty 云账号与同步架构

> 当前产品写入格式：`qwerty-backup-v3`。`qwerty-dexie-gzip-v2` 仅作为旧备份兼容恢复格式；旧的客户端 AES 加密 envelope 已废弃，不做兼容恢复。

## 1. 定位

本模块给 Qwerty Learner 增加可选的“账号 + 云存储 + 跨设备同步”能力，同时保持 local-first：

- 未登录：行为与 upstream 一致，只使用浏览器 IndexedDB；
- 已登录：IndexedDB 仍是实时工作数据库；
- EdgeOne Blob 保存账号状态和同步快照；
- 网络不可用时不得影响正常学习；
- Review、Typing 不依赖云平台可用性。

## 2. 双前端、单后端部署拓扑

生产环境采用两套静态前端、同一套 EdgeOne 云后端：

```text
EdgeOne frontend
https://qwerty-plus.edgeone.dev
            \
             +--> https://qwerty-plus.edgeone.dev/api/* --> EdgeOne Blob
            /
GitHub Pages backup frontend
https://smhe00.github.io/qwerty-learner/
```

约束：

- 两个前端都使用同一个 `VITE_QWERTY_SYNC_BASE_URL=https://qwerty-plus.edgeone.dev`；
- 云账号、session、revision 和 snapshot 因而天然互通；
- GitHub Pages 只承担静态前端备份，不直接访问 EdgeOne Blob；
- Blob 凭据和存储访问能力只存在于 EdgeOne 服务端；
- CORS 默认只额外信任两个生产前端 Origin：`https://qwerty-plus.edgeone.dev` 与 `https://smhe00.github.io`；
- GitHub Pages 的 Origin 不包含 `/qwerty-learner/` 路径；
- EdgeOne 云后端不可用时，两套前端仍可保持 local-first 学习，但云账号/同步同时不可用。

## 3. 代码边界

```text
src/sync/
  CloudSyncSetting.tsx         云同步 UI
  auth.ts                      浏览器登录态
  api.ts                       HTTP client
  snapshot.ts                  Dexie export / gzip / Base64 / restore
  state.ts                     fingerprint + sync baseline

cloud-functions/
  _shared/
    core.js                    认证、Session、revision、冲突、账号删除
    storage/edgeone-blob.js    EdgeOne Blob adapter
  api/[[default]].js           HTTP API entry

tests/
  cloud/                       backend contract / real EdgeOne
  e2e/                         real browser sync
```

## 4. API

```text
GET    /api/health

POST   /api/auth/register
POST   /api/auth/login
GET    /api/auth/me
POST   /api/auth/change-password
DELETE /api/auth/account

GET    /api/sync/meta
GET    /api/sync
PUT    /api/sync
```

`DELETE /api/auth/account` 需要：

- 当前有效 Bearer session；
- 当前账号密码再次验证。

删除成功后 session 因账号 identity 已不存在而立即失效。

## 5. 单账号单 Active Session

登录成功产生随机 opaque session token：

```text
qs1.<usernameHash>.<randomSecretBase64Url>
```

服务端只保存 `SHA256(fullToken)`。

每次新登录创建更高的 session version，只有最新 version 有效。

## 6. 密码

账号密码使用：

```text
scrypt
random 16-byte salt
64-byte derived key
N=16384
r=8
p=1
```

密码不进入同步 snapshot。

## 7. Blob 数据模型

```text
accounts/
  <usernameHash>/
    identity.json
    auth/
      00000000000N.json
    sessions/
      00000000000N.json

users/
  <userId>/
    revisions/
      00000000000N.json
```

账号删除会删除该 usernameHash 下的 identity/auth/session，以及该 userId 下的全部 revisions。

## 8. Snapshot 格式

当前客户端唯一格式：

```text
qwerty-backup-v3
```

生成：

```text
db.export()
   ↓
Dexie JSON
   ↓
pako.gzip()
   ↓
Base64
   ↓
PUT /api/sync
```

服务端要求：

- `clientFormatVersion === qwerty-backup-v3`；
- `payloadBase64` 是规范 Base64；
- 解码后具有 gzip magic bytes；
- payload 不超过 `MAX_SYNC_BYTES`。

服务端当前不需要解析 Dexie JSON，仍把 snapshot 当作整体对象存储；但由于不再端到端加密，云存储管理员理论上可以解压查看内容。

旧格式 `qwerty-dexie-gzip-v2` 可兼容恢复；实验性 `qwerty-sync-envelope-v1` 直接拒绝新上传，客户端也拒绝恢复。

## 9. Fingerprint

客户端对 Dexie export 的逻辑 `data` 做稳定序列化后计算 SHA-256。

fingerprint 用于判断：

```text
clean
local-dirty
remote-ahead
diverged
```

它与 gzip 二进制本身无关，因此压缩实现变化不会误判业务内容变化。

## 10. Revision / optimistic concurrency

即使单账号只有一个 active session，也保留 revision 防止：

- 多 tab；
- HTTP retry；
- 请求乱序；
- stale client state。

规则：

```text
baseRevision == currentRemoteRevision
        ↓
create revision + 1
```

否则返回 `409 sync_conflict`。

## 11. Snapshot retention

只保留最近 3 个完整 snapshot revision。

revision 编号继续单调增长，不复用。

## 12. 下载恢复

```text
GET /api/sync
   ↓
Base64 decode
   ↓
gzip decompress
   ↓
JSON validate
   ↓
peakImportFile metadata validate
   ↓
Dexie transactional import
```

客户端接受当前 `qwerty-backup-v3` 和旧 `qwerty-dexie-gzip-v2`；其他格式不做兼容解码。

## 13. 删除账号

删除操作流程：

```text
valid session
   ↓
verify current password
   ↓
delete auth versions
delete session versions
delete sync revisions
delete identity.json
   ↓
old token becomes invalid
```

前端成功后同步清理：

```text
qwerty.cloudAuth.v1
qwerty.cloudSyncState.v1.<userId>
```

但不删除 IndexedDB。

## 14. 数据职责

```text
IndexedDB
  = 实时工作数据库

EdgeOne Blob
  = account/session state + gzip snapshots

GitHub
  = source + tests + docs + GitHub Pages backup frontend + deployment config
```

## 15. 运行配置

```text
SESSION_TTL_SECONDS=604800
MAX_SYNC_BYTES=4194304
BLOB_STORE_NAME=qwerty-data
VITE_QWERTY_SYNC_BASE_URL=https://qwerty-plus.edgeone.dev
CORS_ORIGIN=https://qwerty-plus.edgeone.dev,https://smhe00.github.io
```

## 16. Upstream 隔离

1. 不要求登录才能学习；
2. 不修改词典格式；
3. EdgeOne SDK 不进入 Review / Typing 主流程；
4. 云同步集中在 `src/sync/` 和设置入口；
5. fork-only cloud 功能不阻碍 Review 独立向 upstream 提交。
