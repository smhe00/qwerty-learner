# Qwerty Plus — 实网验证执行记录（2026-10-09）

## 不可变的测试边界

- 已发布域名：`https://qwerty-plus.edgeone.dev/`；仅验证现有 `master` 发布内容。
- 开发分支：`product/main`。严禁 CI/测试更新 `master`，严禁触发 EdgeOne Maker 构建。
- 真实服务测试仅使用 CI 临时随机账号；不要碰人工/客户账号。
- Trace 必须脱敏；不收集密码、Token、完整 IndexedDB/Blob 或用户词历史。
- 生产端不保留 Playwright 全量 video/trace/screenshot，防止泄漏。
- 本地 `product/main` Chromium 允许独立数据库 fixture、故障注入和失败截图。

## 已实现的三个 Gate

| Gate | 实施方式 | 执行文件 | 验收内容 |
| --- | --- | --- | --- |
| Learn Real Journey | 本地 Chromium + product/main dev server | `tests/e2e/learn-real-journey.spec.ts` | 真实拼写 3 词、每词 durable commit、刷新后继续、完成后刷新无重复证据 |
| Published Learn Browser Smoke | 已发布 EdgeOne、匿名浏览器 | `tests/e2e/production-learn-smoke.spec.ts` | 从界面点击 Learn、完成第一个词、刷新保持进度、连续刷新 URI 不增长 |
| Production Multi-Client E2E | 已发布 EdgeOne + 3 浏览器/2 账号 | `tests/e2e/production-multi-client.spec.ts` | 单活会话、客户端隔离、revision 冲突、下载恢复和本地数据保留 |

## 已观察结果与待解决问题

- `Learn Real Journey`：2026-10-09 运行 `37924495718` 为 **PASS**；修正后版本对 terminal block 采用最后一个词索引、`isFinished=true` 的正确模型。后续提交另验证 redacted artifact 保存。
- `Production Multi-Client`：运行 `37921637349` 的两轮基线均为 **PASS**；新增诊断后出现两次不稳定运行，必须独立排查。
  - `37923874006`：测试 A1 重新登录时账号 UI 未正常出现；清理 B 临时账号时后端 `/api/auth/login` 返回 HTTP **500**；该 B 的删除状态 **未确认**。
  - `37923897904`：恢复后的 `page.goto('/')` 受到 `net::ERR_ABORTED`，疑似应用 reload 与测试主动跳转竞态；两个临时账号均已清理。测试端加入仅针对 `ERR_ABORTED` 的单次重试。
- `Published Learn Browser Smoke` 初轮 `37924634146` 失败：新浏览器直接导航 `/learn` 被正常路由准入重新定向到 `/`，没有 Learn session。后续已改成用户真实的「进入首页 → 点击 Learn」动作，结果需以最新 Gate 为准。

### 未完成清理的测试账户

`e2e_mc_37923874006_1_b`：仅能确认自动 cleanup 请求返回 HTTP 500，**无法证明账号已删除**。此账号为随机密码的临时测试身份；密码未保存在日志，不可通过猜测恢复。未来需使用有权限的云端后台核对该准确账号是否残留，并确认仅包含 E2E 测试数据后再清理。不要将未确认的清理结果报告为通过。

## 下一轮优先级

1. 固定脱敏检查点 artifact 的 `test-results` 输出路径，并确认 CI 真的上传成功。
2. 诊断 API 5xx、登录会话撤销及云恢复导航时序；不得通过放宽不变量绕开失败。
3. 在本地逐步扩展 Hint/ESC、Block=1、意外关闭、账号切换、Backup V4 的真实 UI 操作。
4. 将真实 UI Action/LocalState/CloudRevision 映射至 S0.5 TLA+ 抽象动作；先验证有明确建模对应关系的安全不变量，再讨论状态空间覆盖率。
5. S1 未发布前只在本地验证；正式发布由单独人工发布决策控制。

## 覆盖率边界

本文件记录已执行的测试与显式待解决缺口，**不能将局部 PASS 等同于 S1 完成、TLA+ 全状态穷尽、真实多物理主机故障或 Backup V4 全协议验收**。
