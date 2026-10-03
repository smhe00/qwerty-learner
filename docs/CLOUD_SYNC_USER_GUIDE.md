# 云账号与同步使用说明

> 当前产品采用 `qwerty-backup-v3` 云同步格式。旧 `qwerty-dexie-gzip-v2` 仍可恢复；旧加密格式不再兼容恢复。

## 基本原则

Qwerty 仍然是 local-first 应用：

- 不登录也能正常学习；
- 登录只增加云备份和跨设备能力；
- 本地 IndexedDB 始终是工作数据库；
- 网络中断不会阻止学习；
- 当前版本仍是手动上传/下载，不做自动 record-level merge。

## 账号与在线设备

用户使用用户名和密码登录。密码长度为 4–128 个字符。注册账号时必须连续输入两次相同密码，避免首次录入错误；登录时只输入一次密码。

系统采用 **一个账号只保留一个有效云会话**：

- 在设备 A 登录；
- 随后在设备 B 成功登录；
- B 成为当前有效会话；
- A 的本地数据不会被删除，但 A 再访问云 API 时会收到会话失效，需要重新登录。

## 密码与 Session

账号密码不会明文保存，服务端只保存 scrypt salt/hash。

Session token 是每次登录随机生成的 256-bit opaque token，服务端只保存 token 的 SHA256。

修改密码后会产生新的 auth/session version，旧 session 自动失效。

## 同步格式

当前唯一受支持的客户端格式：

```text
qwerty-dexie-gzip-v2
```

上传路径：

```text
IndexedDB
  ↓
Dexie db.export()
  ↓
JSON
  ↓
gzip
  ↓
Base64
  ↓ HTTPS
PUT /api/sync
  ↓
EdgeOne Blob
```

因此云端 snapshot 的业务数据核心与本地 `.gz` 导出一致，区别主要是云 API 使用 Base64 放入 JSON 传输。

当前版本**不再使用独立云同步加密口令，也不再执行 PBKDF2/AES-GCM 客户端加密**。

HTTPS 仍保护浏览器到 EdgeOne 的传输过程；账号/session 权限控制仍然存在。由于不再做端到端加密，具备云端存储管理权限的一方理论上可以读取并解压同步数据。

## 旧格式

旧的：

```text
qwerty-sync-envelope-v1
```

不再兼容恢复。

如果账号云端仍保存旧格式数据，界面会提示：

> 云端是旧格式，需要用当前本地数据重新上传。

用户确认后可直接用当前本地数据覆盖旧云端 revision，并从此使用 `qwerty-backup-v3` 格式。

## Revision 与冲突保护

云端 revision 单调递增：

```text
0 → 1 → 2 → 3 ...
```

上传必须携带当前 `baseRevision`。如果云端已经变化，服务端返回 `sync_conflict`，不会静默覆盖。

如果：

```text
本地有未同步修改
AND
云端 revision 已前进
```

界面显示分叉状态，由用户明确选择：

- 以本地覆盖云端；
- 使用云端数据覆盖本地。

系统不会自动 merge。

## 云端保存什么

EdgeOne Blob 保存：

- account identity；
- password hash versions；
- session hash versions；
- 最近 3 个完整 gzip snapshot revisions。

业务 snapshot 包含当前 Dexie 导出的学习数据库内容，包括：

- wordRecords；
- chapterRecords；
- reviewRecords；
- reviewWordStates；
- typingTelemetry；
- learningContext。

## 删除云端账号

登录后可在：

```text
设置 → 数据设置 → 云端同步 → 删除云端账号
```

执行永久删除。

删除前必须重新输入当前账号密码并确认。

成功删除后：

- 删除 account identity；
- 删除所有 auth versions；
- 删除所有 session versions；
- 删除全部 sync revisions；
- 当前 token 立即失效；
- 浏览器退出云端登录；
- 删除该账号本机的 sync baseline；
- **保留本机 IndexedDB 学习数据**。

因此“删除云端账号”不是“清空本机学习记录”。

## 当前前端入口

```text
设置 → 数据设置 → 云端同步
```

登录后可以：

- 刷新本地/云端状态；
- 上传本地数据；
- 使用云端数据覆盖本地；
- 查看远端 revision；
- 删除云端账号；
- 退出登录。

## 运行配置

```text
SESSION_TTL_SECONDS=604800
MAX_SYNC_BYTES=4194304
BLOB_STORE_NAME=qwerty-data
CORS_ORIGIN=same-origin
```

GitHub 不保存真实用户学习数据、账号密码或 session token。
