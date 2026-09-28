# EdgeOne Makers 部署与 P4 实机验收

> 分支：`feature/edgeone-cloud-sync`  
> 权威开发状态：`docs/CLOUD_SYNC_DEVELOPMENT_PLAN.md`

## 1. 部署目标

P4 的目标不是接前端，而是先证明：

```text
公网 HTTPS
    ↓
EdgeOne Cloud Function /api/*
    ↓
单账号单 active session
    ↓
EdgeOne Blob strong consistency / onlyIfNew
    ↓
最近 3 个完整 snapshot retention
```

全部在真实 EdgeOne 环境成立。

P4 PASS 前继续保持 `src/` 零修改。

## 2. 在 EdgeOne Makers 导入 GitHub

在 EdgeOne Makers 控制台创建项目：

1. 选择 **导入 Git 仓库**。
2. 连接 GitHub。
3. 选择 `smhe00/qwerty-learner`。
4. **P4 首次创建 Makers 项目时，生产分支直接选择**
   `feature/edgeone-cloud-sync`。
5. 根目录保持仓库根目录。

> 这是 P4 验证阶段的临时生产映射，不代表未来必须长期把 feature 分支当正式生产分支。
> 当前 upstream `master` 不包含 `edgeone.json`、`cloud-functions/` 与云后端依赖，
> 用它做首次 Makers 构建无法验证本分支的 EdgeOne 能力。
> P4/P5 稳定后再决定最终生产分支（例如专门的稳定分支或合并后的 fork 主分支）。

仓库已包含 `edgeone.json`，用于固定：

- install command；
- build command；
- output directory；
- Node 版本；
- Cloud Functions timeout。

Makers 对 Git 仓库支持自动构建部署。项目成功创建以后，再利用非生产分支做 Preview 验证。P4 的首要目标是先让包含 Cloud Functions 的当前分支成功建立项目和公网 API。

## 3. 运行环境变量

应用 V1 不需要任何业务 Secret。

配置：

```text
SESSION_TTL_SECONDS=604800
MAX_SYNC_BYTES=4194304
BLOB_STORE_NAME=qwerty-data
CORS_ORIGIN=*
```

P4 预览阶段可先使用 `CORS_ORIGIN=*`。

正式上线且前后端同域后，再收紧为同源/明确域名。

环境变量修改只影响之后的新部署，因此改完变量后重新部署一次。

## 4. 首次健康检查

部署后获得类似：

```text
https://<preview-domain>
```

访问：

```text
GET https://<preview-domain>/api/health
```

预期：

```json
{
  "ok": true,
  "service": "qwerty-sync-gateway",
  "apiVersion": 1,
  "authMode": "single-active-session"
}
```

如果这里失败，不进入账号测试。

## 5. Blob 命名空间

代码调用：

```text
getStore({
  name: "qwerty-data",
  consistency: "strong"
})
```

第一次真实请求触发写入后，Makers Blob 页面应能看到 `qwerty-data` 命名空间及对象。

生产状态对象主要位于：

```text
accounts/<usernameHash>/...
users/<userId>/revisions/...
```

## 6. 自动实机验收脚本

仓库提供：

```text
yarn test:cloud:edgeone
```

该脚本会真正测试：

1. `/api/health`;
2. 注册；
3. 注册 session 有效；
4. 第一次 login 顶掉注册 session；
5. 第二次 login 顶掉第一次 login；
6. revision 0；
7. 连续上传至 revision 6；
8. stale revision 返回 409；
9. 下载 revision 6 内容一致；
10. Blob 中只保留 revision 4/5/6；
11. 测试完成后删除测试账号、session 与 snapshots。

### 所需本地环境变量

```text
QWERTY_SYNC_BASE_URL=https://<preview-domain>
EDGEONE_PROJECT_ID=<Makers Project ID>
EDGEONE_API_TOKEN=<Makers API Token>
BLOB_STORE_NAME=qwerty-data
```

然后：

```bash
yarn test:cloud:edgeone
```

### 关于 EDGEONE_API_TOKEN

这是 **测试/管理端凭据**，只用于脚本在 Makers Functions 之外直接访问 Blob，并在测试结束后清理随机测试账号。

它：

- 不是 Qwerty 应用的运行 Secret；
- 不配置到 Cloud Function；
- 不进入前端；
- 不提交 GitHub；
- 不替代用户 Session Token。

真实应用运行仍不需要 `APP_SESSION_SECRET`、`TEST_SECRET` 等业务 Secret。

## 7. P4 PASS 标准

必须同时满足：

```text
GitHub Cloud Sync Gate          PASS
EdgeOne deployment              PASS
GET /api/health                 PASS
single-active-session           PASS
revision conflict               PASS
Blob retention [4,5,6]          PASS
test artifacts cleanup          PASS
```

任何一项未满足，都不开始 `src/sync/`。

## 8. P4 后才进入前端

P4 PASS 后第一次修改 `src/`，仅新增：

```text
src/sync/
```

并在现有 Data Settings 中加入最小入口。

Review、Typing 主流程仍不直接依赖 EdgeOne。


## 9. 首次项目创建失败时的分支检查

如果构建日志出现：

```text
No server-handler detected, generating routes.json for pure project...
Generated routes.json for pure project
Build error
```

先确认实际构建的是哪个 Git commit。

对于本项目：

- upstream `master`：没有 Cloud Functions，也没有 `edgeone.json`；
- `feature/edgeone-cloud-sync`：包含完整 Makers/Cloud Functions/Blob 代码。

因此 P4 首次创建项目必须从 `feature/edgeone-cloud-sync` 构建。

`No server-handler detected` 本身只是表示构建器把项目当纯静态站点处理，并不等同于具体错误原因；若在正确的 cloud-sync 分支上仍出现该信息，再按平台构建问题继续排查。
