---
protocol_version: "1.1"
task_id: "TASK-20261023-etest-mobile-account-routes"
status: "IN_PROGRESS"
executor: "Codex (independent mobile UI / staging verification)"
target_branch: "product/main"
claim_base_commit: "28d8b3bf86cbf42facb24bf091a50151c404e21f"
last_source_commit: "dc7290e6783a00140c9bd5cf0d786f4b3bbdd854"
release_to_master: false
---

# etest 手机账号入口 — 部署修复与真实认证验证

2026-10-23，Asia/Shanghai。用户明确要求登录等云相关功能需推 etest；本任务获准推进隔离 etest 并用临时测试账号验证，master 不动。CURRENT_TASK 的并行云同步任务不接管。

## 已验证事实

- 28d8b3bf 的 Cloud Sync Gate、Pages 发布回归、Etest Pilot Admission 均通过；实际 Pages marker 同 SHA 后，正常 fast-forward edgeone-test：596c8564 → 28d8b3bf。master 仍为 6d7839b9a9fd7a31459a19aeca948227b1f7b3c2。
- 修复后真实 Pages 手机预览 3/3 PASS（11.19 秒）：fresh、legacy RecordDB、legacy + 旧凭证均通过，原截图阻断已消除。
- etest 发布 28d8b3b 后，新手机菜单可见，但点击 /mobile/account 被回到 /mobile；独立手机号式 Chrome 复现并保留本地诊断图。真实注册未执行，registered=false，没有测试账号需要删除。
- 根因为 Maker 的 SPA rewrite 不可靠；现有 public/404.html 和 index.html 只允许 /mobile 根路由，物理 HTML 入口也仅生成 /mobile，没有 /mobile/account。既有 /mobile/study 同样遗漏。
- 本机 Node / context.request 直接访问 etest 会遇到平台 401 HTML；实际浏览器加载/预热后，同源 fetch 可读到 source marker 和 JSON health。不能把该访问层 401 误判成用户账号密码失败。

## 源码修复 dc7290e6783a00140c9bd5cf0d786f4b3bbdd854

- index.html、public/404.html：只增加明确 /mobile/account 和 /mobile/study 的恢复白名单，保留 query/hash 与一次性 marker 消费。未知嵌套路径、assets、api、外域仍不得恢复成应用路由。
- scripts/emit-edgeone-spa-entries.mjs：非 Pages 构建为两条真实手机路由生成物理 HTML，使用与根 index 完全相同的内容；Pages 继续原有 redirect 协议。
- tests/cloud/edgeone-spa-route.test.mjs：新增真实脚本执行合同，含两条嵌套路由的完整 404 → index 恢复链与非法路径拒绝。
- tests/e2e/edgeone-s1-cloud-accounts.spec.ts：新增 etest 手机入口及刷新合同，不创建账号；实际测试站注册/退出/登录另用一次性 fixture 过程验证。
- cloud-sync、etest-entry-gate、mobile-p0-gate：将三个部署入口文件纳入路径触发，避免后续路由变更缺失同 SHA 门禁。

## 本地实际验证

| 检查 | 结果 |
|---|---|
| 路由 Node 合同 | 7/7 PASS；保留原 6 项，新增严格嵌套路由合同 |
| 普通生产构建 | exit 0，27.82 秒；两条物理 HTML 与根入口字节完全相同 |
| 普通静态 HTTP 服务器浏览器测试 | 1/1 PASS，5.59 秒；没有 Vite history fallback，真实点击和刷新均保留手机登录界面 |
| Pages 构建 | exit 0，26.98 秒 |
| Pages 三场景回归 | 3/3 PASS，7.80 秒 |
| 全项目 lint | exit 0，0 errors / 120 warnings |
| 新增 etest 浏览器用例解析 | esbuild node20 bundle PASS；初次未显式 target 命令被仓库 es5 配置拒绝，已使用正式 Node target 校验，未执行真实认证 |
| Workflow / diff | 三份 YAML 解析成功；git diff --check PASS |

本次不重造 S1/认证/云同步，也不改后端开关。前一修复的手机账号 11/11 已通过，当前改动只涉及 HTML 路由、构建出口与测试/CI。

## 剩余动作（本检查点尚未完成）

1. 正常推送 product/main，等待最终同 SHA Cloud + Pages + Admission；不得把本地通过写成远端已绿。
2. 同 SHA 正常快进 edgeone-test，再读取真正部署的 source marker。
3. 在手机尺寸独立 profile 用唯一临时用户名/随机密码测试真实注册、退出、重新登录、/auth/me 身份确认；密码仅在进程内存、不录 trace/视频/截图。删除只由本测试确认创建的账号，并验证新登录被拒绝；不盲重试注册或未知结果的删除。
4. 单独记录旧候选真实 V4 transport / M1M3 等失败，不将手机账号通过称为完整云同步已通过；master 不发布。

状态 IN_PROGRESS。继续者可检查 .review-test/etest-mobile-account-live-result.json（无密码）和对应 GitHub E2E run。分支推进和临时账号清理结果必须按实际事实补充。
