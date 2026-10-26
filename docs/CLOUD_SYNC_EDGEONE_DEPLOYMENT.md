# EdgeOne Makers 部署与 P4 实机验收（历史记录）

> **2026-10-26 权威性说明：下文保留 P4/P8 阶段的操作与验收记录，不是当前部署指令。**
> 当前分支角色与发布权限以 [AGENTS.md](../AGENTS.md) 为准，运行架构见 [当前云同步架构](./CLOUD_SYNC_ARCHITECTURE.md)。
> `product/main` 只用于持续开发与禁用云能力的 Pages 预览，禁止把 Maker 生产项目绑定到它。
> `edgeone-test` 固定候选并在 `t.smhe.cn` 独立验证；`master` 是 `q.smhe.cn` 的正式发布线，包含云后端。
> 仅在明确发布授权和候选同 SHA 验收满足后，将 master 快进到该候选。main 可以继续前进，不要求三个分支头相同。
> 本次仅修正文档；不变更项目绑定、配置、数据、部署分支或既有门禁。

以下章节中的项目 ID、平台限制、保留数、命令和测试结果均有各自历史上下文；执行前须重新核对，不能据此重试未知写入或清理真实数据。

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

## 2. P4/P8 历史导入流程（不再执行旧分支映射）

当时在 EdgeOne Makers 控制台创建项目的步骤记录：

1. 选择 **导入 Git 仓库**。
2. 连接 GitHub。
3. 选择 `smhe00/qwerty-learner`。
4. P4 首次创建时使用 `feature/edgeone-cloud-sync`，当时曾计划 RC 后切到 `product/main`。该计划已被现行 master 发布规则替代，不得继续应用。
5. 根目录保持仓库根目录。

> 当时的 upstream master 是纯静态来源分支，曾有 `dist/` 与实际 `build/` 不一致的问题。这不是当前 master 的角色或文件清单；当前 master 已是正式云产品发布线。

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
CORS_ORIGIN=same-origin
```

早期 P4 预览曾允许临时使用 `CORS_ORIGIN=*`。当前 hardened 配置应使用 `CORS_ORIGIN=same-origin`；只有明确的可信跨域部署才使用显式 allowlist。正式环境不要使用 `*`。

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
QWERTY_SYNC_BASE_URL=https://<domain>/?eo_token=<temporary-token>&eo_time=<temporary-time>
EDGEONE_PROJECT_ID=<Makers Project ID>
EDGEONE_API_TOKEN=<Makers API Token>
BLOB_STORE_NAME=qwerty-data
```

`QWERTY_SYNC_BASE_URL` may contain EdgeOne access-protection query parameters. The integration script preserves those query parameters when it calls every `/api/*` endpoint.

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

如果日志中出现：

```text
✓ built
[StaticAssetsBuilder] ✓ Build project completed
ENOENT ... /dist
```

说明应用编译已经成功，真正失败点是 **EdgeOne 的输出目录与 Vite 实际产物目录不一致**。

本项目 `vite.config.ts` 明确设置：

```text
build.outDir = "build"
```

因此正确输出目录是：

```text
./build
```

而不是 Vite 框架预设通常使用的：

```text
./dist
```

`product/main` 根目录的 `edgeone.json` 已显式设置 `"outputDirectory": "./build"`。

当时的 upstream master 静态快照没有 `edgeone.json`，因此曾手工选择 `build`。此历史差异不得用于判断当前 master 的配置或覆盖当前项目绑定。

另外：

```text
No server-handler detected, generating routes.json for pure project...
```

该提示仅描述当时没有 Cloud Functions 的静态快照。当前正式云部署必须依据所验收的 SHA 和实际 Cloud/Blob 检查，不能用这条历史说明忽略后端缺失。


## 10. Historically verified Makers identity

For the current international-site project:

```text
region=global
site/zone=zone-3vjkordh7u8k
projectId=makers-cgemngjuuwle
```

The project ID was verified via `@edgeone/makers-sdk` project listing, and external Blob SDK authentication was verified with:

```text
listStores({
  projectId: "makers-cgemngjuuwle",
  token: <Makers API Token>,
  consistency: "strong"
})
```

which returned:

```text
{ stores: [] }
```

before the first Blob write. An empty store list is expected at this stage and confirms credential exchange succeeded.


## 11. V1 Release / rollback checklist

This section is for the public-release handoff after P8 passes.

Before promoting a release candidate:

1. record the exact Git commit SHA;
2. record the EdgeOne deployment ID and production domain;
3. verify `CORS_ORIGIN=same-origin` (or the intended explicit allowlist) in the production environment;
4. require PASS from:
   - Cloud Sync Gate;
   - EdgeOne Live Gate;
   - EdgeOne Browser Sync Gate;
   - EdgeOne Auth Rate Limit Gate;
5. keep the previous known-good deployment/commit identified as the rollback target.

Rollback principle:

```text
bad production deployment
        ↓
stop further promotion
        ↓
redeploy previous known-good EdgeOne deployment/config
        ↓
verify /api/health + browser local-only operation
        ↓
run Live Gate before re-promoting
```

Cloud sync remains optional/local-first, so a cloud rollback must never block the base learning application.
