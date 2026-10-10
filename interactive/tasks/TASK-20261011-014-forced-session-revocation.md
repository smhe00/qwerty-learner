---
protocol_version: "1.1"
task_id: "TASK-20261011-014-forced-session-revocation"
task_file: "interactive/tasks/TASK-20261011-014-forced-session-revocation.md"
report_file: "interactive/reports/TASK-20261011-014-forced-session-revocation-report.md"
target_branch: "product/main"
status: "READY"
executor: "unassigned"
release_to_master: false
priority: "P0"
---

# P0 — 异地登录强制退出 + 安全恢复本机匿名账户

## Objective

服务器已经只允许每个 `userId` 最新的单个 Session Token 有效，但旧设备不会被主动提示和退回本地匿名工作区。必须在公开启用 S2 Sync 入口前闭环。

## Actual baseline

- `cloud-functions/_shared/core.js` `authenticate()` 对旧 token 返回 HTTP 401 `session_revoked`。
- EdgeOne 实网 `test24` 第二设备登录使旧 token 失效，Actions [38085108313](https://github.com/smhe00/qwerty-learner/actions/runs/38085108313) PASS。
- `src/sync/CloudSyncSetting.tsx` 仅在旧版 API 错误处显示“当前登录已被其他登录替代，请重新登录”；没有全局检测/弹窗或确认后 S1 事务退出。
- `src/sync/workspace-auth-transaction.ts` 提供已验证的显式 account→anonymous 本地工作区切换。此机制必须复用，不得简单删除 token。

## Acceptance criteria

- [ ] 活跃账号的全局检查：页面 `visibilitychange` 回到前台、focus 以及约 30s 低频 GET /api/auth/me；已收到 `session_revoked` 的所有云 API 请求应触发同一确定性状态机，避免弹窗重复。
- [ ] 仅以明确 `401 session_revoked` 判断“另一设备登录”；`session_expired`、无网络、超时、429/503 必须走单独提示，不能当作被踢。
- [ ] A 被 B 顶掉后暂停自动云同步，提示“其他设备已登录，本机完整学习记录将保留”；用户点击确认后进入受 S1 writer lease 保护的 pre-mount transaction，持久化账号 V4 → 安全切换匿名 → fresh realm reload。
- [ ] 不能从已挂载 React/RecordDB 的界面直接运行切换事务；必须先导航到受保护入口。若事务失败，保留原账号 Vault/journal 并 fail closed。
- [ ] 异常期间本地 Learn/Typing 数据不得丢失；提示不可谎称云端上传完成；未同步数据继续归属原账号，匿名数据仍独立。
- [ ] 两个独立 Chromium profile/BrowserContext：A 登录→B 登录→A 被撤销→用户确认→A 匿名，B 仍登录，A 原账号 V4 Vault SHA/六表保留；网络离线、普通过期、取消、强制刷新和 journal 崩溃注入。
- [ ] 通过 Cloud Sync Gate、S1 Chromium Gate、Learn Journey，并在一次性账号上进行 Maker 验证。没有验收证据不能启用公开 S2。

## Constraints

只改 `product/main`，明确 release gate 后才同步 `master`。禁止操作真实用户云端数据。使用独立任务报告记录逐项验证与 SHA。
