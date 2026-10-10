# Qwerty Plus — S2 P4b Maker 灰度 / 回滚操作契约

状态：**预发布准备；尚未授权 Maker 新构建；不可声称实网 PASS**。
开发主线 `product/main`；当前生产发布分支 `master`。将此文档
纳入 P4b-4 操作预案，不代表 P4b-3 已执行。

## A. 进入实际 EdgeOne 验收之前（Release BLOCK）

- [ ] Cloud Sync Gate、S1 Workspace Chromium Gate、原有 Learn Journey /
  Typing / Review / Achievement Gate、S0.5 TLA 和 P4b S2Recovery TLA
  在同一候选 SHA 上 PASS；存在失败须先隔离根因。
- [ ] 至少一台完整 V1/V3 旧客户端实例尝试对已升级 V4 revision
  进行旧接口上传，服务端必须以 409/明确版本冲突拒绝，且云端 SHA 未变。
- [ ] 单独验证 S1 用户显式迁移：用户原 V1 本地学习数据有原始备份；
  关闭所有旧 JS 标签页；迁移后浏览器启动、学习、切换账号与清空
  旧 storage 的防护都通过。
- [ ] 明确落实**服务端账号白名单**或专用预发布环境，尤其是
  `PUT /api/sync/v2` 及 `PUT /api/sync/v2/recovery`。
  仅前端 `VITE_S2_ENABLE_UNIFIED_SYNC` 开关**不构成访问控制**。
  白名单逻辑若不存在，不得将 API 在生产 master 上开放用于真实用户。
- [ ] 后端生产兼容现存 V1 路径；真实 Blob 密钥权限、容量与
  4MiB/32MiB 压缩/解压限制已经确认。未满足其中任何一项禁止提升生产。

## B. 一次受控 Maker 灰度

1. 由发布人确认候选 `product/main` SHA 与验收证据，冻结候选；
   获取用户明确授权后才将其同步到 `master`。尽量一次 Maker 构建。
2. 发布前保存 `master` SHA、部署版本和配置快照。对现网真实账号
   不做测试数据写入、删除、迁移。
3. 仅使用 **3 个一次性灰度测试账号**；A/B 设备使用同一账号，C
   另一个账号。测试密码不可写入 Git/GitHub Actions 日志。
4. 先验证真实 `/api/sync/v2/meta`，再做完整 V4 Push/Pull：
   比较远端 revision、payloadSha256、logicalFingerprint；
   每端 Backup V4 六表记录数、逐表 SHA、导航及 DailySession 均一致。
5. A/B 各添加不同 FSRS/WordRecord；并发 Sync，同一 revision
   只允许一个 CAS 成功。失败端不能丢记录、不能隐式覆盖。
6. C/切换账号、凭证到期、浏览器重启、失败网络请求，
   校验 accountId 不串数据，挂载前 journal 重放完成；
   成功必须在本地 baseline commit 后才能宣告。
7. 显式 V3→V4 迁移测试：用户单独下载原始云端 gzip、下载本地
   Backup V4、确认两份保存、输入不可变账号 ID、确认恢复方向；
   然后验证第二设备下载恢复。不能自动转换真实用户数据。
8. 最后对已迁移灰度账号模拟旧 V1 客户端上传，必须被拒绝；
   连续刷新和第二设备再同步，不出现无用户动作的意外 dirty/冲突。

## C. 数据一致性证据

每一轮至少留存**不含词条或凭证**的结构化摘要：
`device`、`accountId`（脱敏）、`revision`、`logicalFingerprint`、
`payloadSha256`、六表 rowCount + rowDigest、事务日志阶段、
`success|conflict|blocked`、网络故障注入点和预期结果。

硬阻断：任何跨账号恢复、未确认覆盖、回放后数据混合/损失、
成功通知早于 durable commit、或同一 revision 多个成功写入者。

## D. 回滚

**不要简单将 master 回退成旧 V1 前端再允许旧 /sync 写入。**
已升级 V4 的账号必须维持服务端 V1 写保护。
若灰度失败：

1. 立即关闭/限制 V2 新写请求（必须为服务器开关/权限，不仅前端）。
2. 将候选网站回退到最后一个**V4 可读、且仍保护 V1 写入**的版本；
   如果没有这类版本，保持云端只读并提示用户暂停 Sync。
3. 保存当前 Blob V4 revision 和原始 V3 备份，不删除任何已有快照。
4. 取受影响设备本地 Backup V4；比对每张表以及 DailySession、FSRS
   状态，与最后确认成功的云端 revision 一致后才能复开写入。
5. 使用一次性测试账号演练完整恢复，确认不会要求用户重新注册
   同一不可变 accountId 或丢弃原有 Vault。
6. 失败根因、回滚版本、受影响账号范围和复开条件记入报告。

## E. Release 决策

P4b-3 EdgeOne Maker 实网检查和 P4b-4 回滚演练**不允许用模拟云
测试替代**；需要用户单独授权一次上线或提供可用的隔离测试环境。
若没有该授权，P4b 只能宣布“开发 Gate 收口完成，生产 Gate 阻断”。

### S2 服务端写入灰度隔离（开发分支待发布）

从 `product/main` 的提交 `486198b` 起，EdgeOne 后端的
`PUT /api/sync/v2` 和 `PUT /api/sync/v2/recovery` 均调用服务端身份验证，
然后按不可变 `user.userId` 与环境变量 `S2_SYNC_WRITE_ACCOUNT_IDS`
比较。配置格式为以逗号分隔的完整账号 ID，例如
`test-user-id-A,test-user-id-B`；**不能填用户名或密码**。
不配置、空值、无匹配项或包含 `*` 时返回 HTTP 403
`s2_write_not_enabled`；GET、登录注册、旧版 V1 API 不依赖此开关。
白名单并不跳过既有 revision CAS / V4 payload / account owner 校验。

EdgeOne 部署操作：先登记隔离账号的 `userId`，再在生产函数的
**服务端环境变量**设置上述白名单。此配置不是前端的 `VITE_` 变量。
更新发布分支之前验证 Cloud Sync Gate、灰度拒绝测试及构建，
再以一次 Maker 构建升级服务端。部署后先用非白名单一次性账号验证
PUT 返回 403，并确认其 revision 没有变化；随后用白名单测试账号
验证 PUT 可按普通 CAS 规则执行，最后清理临时测试账号或撤销白名单。

**注意：目前 master 发布版本尚未包含此隔离，禁止把开发分支代码已提交
视为生产服务端隔离已经生效。**
