# 云账号与同步使用说明

> 当前文档描述正在开发的 EdgeOne 云同步能力。后端 API 稳定后再接入 Qwerty UI。

## 使用原则

Qwerty 仍然是 local-first 应用。

- 不登录：可以正常学习，数据只在当前浏览器 IndexedDB。
- 登录：增加云备份和多设备同步。
- 网络断开：本地学习不受影响。
- 恢复网络后：再执行同步。

## 账号

用户使用容易记忆的“用户名 + 密码”。

密码不会明文保存。服务端只保存 scrypt 的 salt/hash。

修改密码后，旧登录 Session 会自动失效。

## 多设备

同一账号可以在多台电脑登录。

每次上传带当前远端 revision。若另一台设备已经更新远端，旧设备上传会收到 `sync_conflict`，客户端必须先拉取、合并，再提交下一 revision。

因此服务端不采用 last-write-wins。

## 云端保存内容

后端保存账号身份、密码 hash 和 opaque 同步 payload。

后端不解析具体单词、错题、Telemetry、Review scheduler 数据。

未来前端会在上传前对 IndexedDB 快照进行压缩和客户端加密。

## 隐私

真实 Secret 不进入 GitHub。GitHub 只保存 `.env.example` 中的变量名。

正式环境至少需要：

```text
APP_SESSION_SECRET
BLOB_STORE_NAME
SESSION_TTL_SECONDS
MAX_SYNC_BYTES
CORS_ORIGIN
```

完整自测只在开发期间开启：

```text
ENABLE_SELF_TEST=true
TEST_SECRET=...
```

上线后必须关闭。
