---
protocol_version: "1.1"
task_id: "TASK-20261011-015-maker-intermittent-500"
task_file: "interactive/tasks/TASK-20261011-015-maker-intermittent-500.md"
report_file: "interactive/reports/TASK-20261011-015-maker-intermittent-500-report.md"
target_branch: "product/main"
status: "READY"
executor: "unassigned"
release_to_master: false
priority: "P1"
---

# P1 — EdgeOne/Blob V3→V4 迁移拒绝的偶发 HTTP 500

## Actual evidence

- 初次真实 Maker 运行 [38084721962](https://github.com/smhe00/qwerty-learner/actions/runs/38084721962)：测试账号旧 V3 云端尝试普通 V4 写入时得到 500 `internal_error`，预期是 409 `sync_migration_required`；两个一次性账号已删除。
- 随后独立重跑 [38085108313](https://github.com/smhe00/qwerty-learner/actions/runs/38085108313) 两次完整协议 PASS，未重现；同一真实 V4 数据跨 Maker 回滚 [38086096338](https://github.com/smhe00/qwerty-learner/actions/runs/38086096338) PASS。不能因此把首次 500 视为不存在。

## Deliverables

- [ ] 在独立账号下进行 N 次 V3→V4 隐式迁移拒绝路径真实 Blob 压测（按 EdgeOne 速率限制控制频次），保存状态分布/失败率。
- [ ] 对齐 Maker 版本、服务端运行日志时间与请求，检查 `getLatestRevision`、strong list/get、retry、读取 snapshot 与异常映射，查明根因。
- [ ] 任何 5xx / 不确定成功均不得推进本地 baseline；恢复前按远端 revision、payload SHA 和 fingerprint 重核验。
- [ ] 不允许将未知 500 捕获后盲目转成 409，也不可无 CAS 重查就自动重传 PUT。
- [ ] 增加后端与浏览器回归，CI/实网 PASS 后记录脱敏证据、解决状态。

## Constraints

避免日志输出 Token、密码、学习词条。禁止生产真实用户账号写入。生产 S2 公开入口仍保持关闭。
