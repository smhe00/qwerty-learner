---
protocol_version: "1.1"
task_id: "TASK-20261023-etest-mobile-account-routes"
status: "REVIEW"
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

## etest 现场验收（手机账号范围已完成）

- 最终验收候选 c187c73ee4fd9ff25fbb133d5c2be1768ecae2f2，包含上述源码修复及本报告初始检查点。Cloud Sync Gate [39864212948](https://github.com/smhe00/qwerty-learner/actions/runs/39864212948)、Pages [39864212911](https://github.com/smhe00/qwerty-learner/actions/runs/39864212911)、Admission [39864212825](https://github.com/smhe00/qwerty-learner/actions/runs/39864212825) 同 SHA 均 SUCCESS，实际 Pages marker 完整匹配后才正常快进 edgeone-test：28d8b3bf → c187c73e。
- 实际 etest marker 为 c187c73（严格匹配候选前缀）。手机尺寸独立 Chrome profile，真实同源 API，无路由 mock，完成注册 → 手机首页显示正确用户名 → 安全退出回匿名 → 重新登录 → /api/auth/me 与不可变 userId 一致。
- 注册使用随机唯一 fixture 身份，HTTP 201 回执确认创建后才允许清理。注册没有复制原学习资料，整个 profile 为临时空白数据。密码只在进程内存，异常消息脱敏，未开启 trace、视频或截图。
- 账号测试全过程 PASS，约 11 秒；结束时用本 fixture 的凭据重新确认身份，DELETE 只执行一次且响应成功，再确认新登录返回 401 / invalid_credentials，cleanup=true。没有遗留本次临时账号，也没有操作用户真实账号。
- 脱敏实测结果已保存到 interactive/reports/evidence/TASK-20261023-etest-mobile-account-live.json（无密码、token 或用户学习数据）。
- 当前 backend authMode 是 single-active-session。手机单账号验证成功不等于 M1/M3 多设备认证或自动收敛已完成。独立的 etest M1M3 / 三设备 E2E 在检查 backend pilot，Branch EdgeOne Cloud E2E 仍执行中；不得报告全部云测试通过。Safe V4 Writeback Pilot 同候选运行 39864673627 已成功，其他结果另按实际 CI 状态核对。

## 最终交付边界

状态 REVIEW。手机登录入口和真实账号流程已验证，可从 https://etest.edgeone.dev/mobile/account 试用。master 始终未改，仍为 6d7839b9a9fd7a31459a19aeca948227b1f7b3c2。此报告/证据的完成记录另行提交 product/main，**不为纯报告再次推进 etest 触发 Maker 构建**；etest 固定为实际验收的 c187c73e，主线与该候选应用源码一致，仅 interactive 交付记录向前。

后续完整云同步和任何 master 发布仍需按最终候选重新核对既有门禁与明确发布授权。CURRENT_TASK 归属保留，不对并行同步实现作额外修改。阻塞依赖 None（手机账号范围）。
