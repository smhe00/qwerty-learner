# Qwerty Plus — S2-P3b 高级云同步恢复（开发验收）

**状态：DEV 验收通过；禁止直接发布生产。** 开发主线为 `product/main`；
EdgeOne Maker 对应 `master`，本轮没有同步或发布。

## 使用条件

正常学习只显示一个 **Sync** 按钮。若发现两端均变化（Conflict）
或云端仍是 V3，则进入 **高级恢复（冲突 / V3 数据迁移）**；
这是独立的应用挂载前安全页面，仅 Vite DEV 或明确
`VITE_S2_ENABLE_UNIFIED_SYNC=true` 时可使用。匿名工作区禁止同步。

## 用户操作约束

1. 校验登录会话属于当前不可变 accountId，以及云端 revision、
   格式、原始 SHA 和本地 V4 指纹。
2. **分别下载并核对两个文件**：本机完整 V4 gzip；云端原始
   V3/V4 gzip（不在下载时篡改原文件），并手动勾选已保存。
3. 明确选择 **保留本地** 或 **保留云端**，完整输入不可变 accountId。
4. 再次确认覆盖风险；操作前重验本地指纹、账号会话和云端
   revision+SHA，任一改变即停止。不会自动合并学习记录。

保留本地：使用专用 `PUT /api/sync/v2/recovery`、准确的
`baseRevision`、云端 SHA / Format、accountId 和 CAS；成功后才更新
本地同步基线。若云端 V3，先以本机 V4 显式迁移，旧版账号的
V1 上传入口仍会被拒绝。

保留云端 V4：按原始云端 SHA+逻辑指纹验真；保存本机 V4 独立副本，
持久化 Pull 日志，然后进入新页面。只有 S1 启动门禁在无
React/RecordDB 写者时执行完整恢复、见证重封存及基线提交，之后
才显示恢复成功。

保留云端 V3：原始 V3 备份必须包含完整六表 Dexie 数据结构，
先转换为 V4 并通过专用服务端迁移 CAS，再以上述安全日志恢复本机。
**V3 可能不包含后来加入的设置/每日学习会话，这些数据无法从旧备份恢复。**
不完整的历史 V2/V3、损坏的压缩包或未知格式必须保留原始备份并
停止自动迁移，不允许猜测补齐学习记录。

## 中断和故障语义

- 账号错误、过期登录、网络失败、Base64/SHA 不符、旧 revision：
  **拒绝新写入**。不允许重复盲目覆盖。
- 云端请求已提交但响应丢失：本机原样保留，可刷新元数据后再决定。
- Pull 日志已提交但本机尚未恢复：重启必先重放 V4，
  任何损坏/所有权冲突均阻止学习应用挂载。
- 云端会保留有限历史 revision，不能依赖云端永远保留旧 V3；
  **用户下载的双份 gzip 是显式回滚的必要条件**。

## 自动化测试证据

- [Cloud Sync Gate — 100/100 PASS](https://github.com/smhe00/qwerty-learner/actions/runs/38050718488)
- [S1 Browser Gate — 58/58 PASS](https://github.com/smhe00/qwerty-learner/actions/runs/38050718549)

## 生产放行前必须补齐（P4b）

- 真正的 EdgeOne Maker 部署及一次性账号、多设备端到端同步测试。
- 从正在使用的 V1 迁移到独立 V4 工作区的用户授权、旧标签页淘汰、
  故障恢复及灰度回滚验收。
- 更深入验证 Dexie 六表 **逐表 rows 数据完整性**；对新增的
  显式恢复 CAS 路径补足 TLA+/负向测试。
- 单独复核 Learn Journey 当前存在的回归/偶发失败。
- 经明确授权才允许 `product/main` 合入 `master`；不得因
  P3b DEV Gate 通过就自动发布 Maker。
