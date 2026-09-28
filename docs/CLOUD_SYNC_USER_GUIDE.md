# 云账号与同步使用说明

> 当前手动云同步前端已通过真实 EdgeOne 浏览器验证。实施状态以 `docs/CLOUD_SYNC_DEVELOPMENT_PLAN.md` 为准。

## 基本原则

Qwerty 仍然是 local-first 应用：

- 不登录也能正常学习；
- 登录只增加云备份和跨设备能力；
- 本地 IndexedDB 是工作数据库；
- 网络中断不会阻止学习。

## 账号与在线设备

用户使用用户名和密码登录。

V1 采用 **一个账号只保留一个有效云会话**：

- 在设备 A 登录；
- 随后在设备 B 成功登录；
- B 成为当前有效会话；
- A 的本地数据不会被删除，但 A 再访问云 API 时会收到会话失效，需要重新登录。

这减少了两台设备同时写云端造成的复杂冲突。

## 密码和 Session

密码不会明文保存，服务端只保存 scrypt salt/hash。

Session token 是每次登录随机生成的 256-bit opaque token。

服务端只保存 token 的 SHA256，不保存 token 原文。

系统不使用 JWT，因此无需 `APP_SESSION_SECRET`。

修改密码后会产生新的 auth/session version，旧 session 自动失效。

## 同步

云端仍保留递增 revision：

```text
0 → 1 → 2 → 3 ...
```

即使只有一个 active session，也需要 revision 防止：

- 多浏览器 tab；
- 请求重复发送；
- 网络 retry；
- 请求乱序。

如果客户端携带的 `baseRevision` 不是当前远端 revision，服务端返回 `sync_conflict`，不会静默覆盖。

## 离线数据冲突

单 session 不能消除“旧设备离线学习”造成的分叉。

如果本地存在未同步修改，同时云端 revision 已经前进，第一版不会自动合并，也不会自动覆盖。

当前数据设置页会明确标出分叉状态，并要求用户手动选择“以本地覆盖云端”或“使用云端数据”。系统不会自动合并或静默覆盖。

## 云端保存什么

EdgeOne Blob 保存：

- 账号 identity；
- password hash versions；
- session hash versions；
- opaque sync snapshots。

后端不解析具体单词、错题、Review scheduler 或 telemetry。

P6 浏览器会先 gzip Dexie/IndexedDB 导出结果，再使用独立的云同步加密口令执行 AES-256-GCM 加密，然后才上传 opaque Base64 快照。后端不解析业务内容，也拿不到加密口令。

云同步加密口令与登录密码分离，仅保存在当前页面内存中。页面刷新或重新打开后需要再次输入；第二台设备必须输入相同口令。服务器无法找回遗忘的加密口令。

## 运行配置

V1 不需要人为生成 Secret。

```text
SESSION_TTL_SECONDS=604800
MAX_SYNC_BYTES=4194304
BLOB_STORE_NAME=qwerty-data
CORS_ORIGIN=*
```

GitHub 不保存真实用户数据或 session token。


## 当前前端入口

打开：

```text
设置 → 数据设置 → 云端同步
```

未登录时可注册或登录。登录后可：

- 刷新本地/云端状态；
- 手动上传本地数据；
- 手动使用云端数据覆盖本地；
- 查看远端 revision；
- 退出登录。

同步不是学习主流程的一部分，网络失败不会阻止本地学习。

本地状态判断使用当前 IndexedDB 逻辑内容指纹与该账号上次同步基线比较，不需要修改现有数据库 schema，也不在 Typing 写路径里插入云端逻辑。


## 加密口令注意事项

云端加密口令无法找回。它与账号登录密码是两个不同的概念：

- 登录密码用于登录账号；
- 云端加密口令只在浏览器内用于加密/解密学习快照；
- 云端加密口令不会发送给服务器；
- 页面刷新后需要重新输入；
- 新设备恢复数据时必须输入相同的云端加密口令。

如果遗忘加密口令，已有云端加密快照无法解密，但本机学习数据仍可继续使用并可手动导出。
