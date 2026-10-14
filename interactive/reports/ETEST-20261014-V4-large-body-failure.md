# etest 实网验证：V4 大包请求体读取失败（P0）

记录时间：2026-10-14；环境：`https://etest.edgeone.dev/`（与 master Blob 空间独立，由项目所有者确认）；源代码：`edgeone-test` = `e7fe002790d03d5e43331b68821903352565b867`。**该现场不是已经完成全功能验收的标志。**

## 验证证据

- [真实 EdgeOne Cloud E2E / GitHub Actions](https://github.com/smhe00/qwerty-learner/actions/runs/38487149717)，三次运行。
- 首次运行在 `/source-commit.txt` 返回 HTTP 404 时失败，未产生测试账号；后续重跑（无需新增 EdgeOne 构建）确认线上已经部署 `e7fe0027`，API 健康检查和静态 SHA 校验通过。
- 第二次运行：S1 真浏览器 E2E 两账号/三个独立 Chromium profile **PASS**，账号清理 PASS；真实 V4 Blob 写入、过期 revision 保护、不同账号隔离 PASS；大包 stress：256 KiB 随机源对应 gzip 压缩 263852 bytes，HTTP 200；512 KiB 随机源对应 gzip 压缩 527113 bytes，HTTP 503 `snapshot_body_read_failed`，云 revision 未推进。
- 第三次运行：S1 E2E 继续 **PASS**，清理 PASS；256 KiB 源（gzip 263841 bytes）HTTP 200；512 KiB 源（gzip 527108 bytes）HTTP 200；1024 KiB 源（gzip 1053600 bytes）HTTP 503 `snapshot_body_read_failed`，云 revision 未推进。失败测试专用临时账号清理 PASS。
- 整体工作流状态 **FAIL**：`real-v4-transport` FAIL，`live-browser-cloud` PASS，`release-ready` skipped。M1/M3 不可变事件试验工作流因未启用专用 flags 而 skipped；不能宣称独立多设备写入已实网通过。

## 已确认故障区间

`cloud-functions/api/[[default]].js` 的 `PUT /sync/v2` 在写入前先执行 `readJson(request, bodyLimit)`。该方法内部为 `await request.text()`；读取抛出非 `AppError` 异常时返回 503 `snapshot_body_read_failed`。日志显示失败发生在 **HTTP 请求体接收**，早于 V4 gzip 校验与 Blob 分块的任何逻辑。

注意日志中的 `requestBytes` 是 gzip 二进制字节数，不是完整 JSON HTTP 请求体。Base64 会使 HTTP 实际内容扩张约 4/3。约 1 MiB gzip 数据传输需要约 1.4 MiB 请求体；但 512 KiB 级请求也出现过偶发失败，不能未经复测即宣称固定阈值为 1 MiB。

Tencent EdgeOne Makers Cloud Functions 文档给出的请求/响应体一般限制为 6 MiB（https://pages.edgeone.ai/document/cloud-functions）；另一种 Edge Functions 的 `request.text()` 限制为 1 MiB，并建议流式读取（https://edgeone.ai/document/52690）。**这是不同执行环境；实际运行时哪一个限制起作用尚需实证，不能混淆。**

## 数据安全约束与修复准入

1. 优先在 `product/main` 做无凭据体积/异常类型诊断、分段复现和 bounded-stream 接收的本地契约测试。不要直接在真实账号重复尝试大包。
2. 若 EdgeOne HTTP 适配器有硬限额，应使用多请求上行分块协议（每个请求低于实测安全上限），不可变块 SHA、明确账号作用域、逐块回读、幂等完成清单；保持 V4 无损且禁止仅凭 Blob list 断言完整性。
3. 含糊的 503 / 网络中断不得盲目更换内容重试。先只读核对云端 revision、SHA 和 logical fingerprint，任何未知状态 fail-closed。
4. 在单元/故障注入 + Pages + Cloud Gate 全部通过后，选择性同步 etest（仅一次新的 Makers 构建），验证 256、512、1024、1536、2048、2700 KiB 压缩前随机压力负载、每次云端精确回读及账号清理。
5. 该门禁未通过以前 **不得推进 `master`**。此外 M2 六表无损合并 / M4 用户端多设备自动同步和崩溃恢复仍需独立完成。

## 当前状态

`product/main` 与 `edgeone-test` 之前在 `e7fe0027` 对齐；本报告仅记录在 `product/main`，不会自动部署 etest。生产 `master` 未更新。
