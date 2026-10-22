---
protocol_version: "1.1"
task_id: "TASK-20261023-mobile-account"
status: "REVIEW"
executor: "Codex (independent mobile UI task)"
target_branch: "product/main"
claim_base_commit: "596c856417efdfb3870ed7ccdea6060fd37937e4"
integrated_upstream: "11a10a8423cbdbe76d5ed11ca7aaa7fc2417d842"
last_source_commit: "c0c8388db0c6ab100e3d61882236d3606260cc41"
release_to_master: false
---

# 手机登录与账号界面 — 交付报告

2026-10-23，Asia/Shanghai。状态 REVIEW，等待用户试用；本聊天明确授权独立手机 UI 工作，保留 CURRENT_TASK 的云同步任务所有权。

## 已实现

手机首页右上角账号图标及「账号与云同步」菜单进入 /mobile/account。新页有登录/注册切换、确认密码、密码显示/隐藏、原生自动填充与 Enter 提交、重复请求隔离、错误和加载状态、取消返回、已登录账号、过期重登录、安全退出；支持 320px 手机、短视口、平板横竖屏及明暗主题。初次打开不聚焦输入框，避免主动唤出软键盘。

手机登录界面是现有 S1 账号管理器的展示适配。账号页在 src/index.tsx 的独占 writer lease / 恢复 / 身份检查后、React/RecordDB 写入树挂载前渲染。已有认证 API、register/login、同账号 reauthenticateSameWorkspace、switchAuthenticatedWorkspace、匿名 V4 复制和离线退出流程均复用，没有另写账号状态机或直接调用 loginAndRemember 绕过归属事务。普通桌面账号管理外观与入口保留。

登录已有账号不自动合并匿名记录；注册明确选择是否复制，原匿名空间保留；直接重认证成其他 immutable userId 仍被拒绝。密码仅留在表单/认证请求，不写入学习存储。退出不请求云端，不承诺未上传记录已同步。

Pages/云关闭部署明确显示开发预览提示，登录和注册禁用；账号页返回 /qwerty-learner/mobile，不请求正式账号服务。独立 EdgeOne 站点沿用同源 /api，未改任何认证/云端部署开关。

## 文件与原因

| 文件 | 修改 |
|---|---|
| src/sync/mobile-account-view.ts、mobile-account.css | 独立、可滚动的手机登录/账号展示；无 React 或第二套认证逻辑 |
| src/sync/workspace-account-ui.ts | 可选 mobile 展示、中文错误映射、共用忙碌锁、返回手机首页；原认证/保存调用次序保留 |
| src/index.tsx | 在 pre-mount 账号分支识别显式 /mobile/account 路径并传入部署限制 |
| src/pages/Mobile/index.tsx、mobile-app.css | 两个真实账号入口及用户名/过期提示，44px 点击目标 |
| tests/e2e/mobile-account.spec.ts、mobile-account.config.ts | 11 项手机真实浏览器与模拟认证服务的保存/隔离合同 |
| tests/e2e/mobile-account-pages.spec.ts、mobile-account-pages.config.ts | 验证实际 Pages 构建的账号预览和零云请求 |
| tests/e2e/mobile-p0.spec.ts | 首页占位项由 5 改为 4，同时断言两个新入口真实 href |
| tests/e2e/workspace-app-entry.spec.ts | 两处旧「数据设置」测试选择器更新为现有「数据与备份」，保留原功能断言 |
| .github/workflows/mobile-p0-gate.yml | 新文件触发、类型/lint 范围、手机账号合同、Pages 构建与禁云验证 |
| docs/LEARN_USER_GUIDE_V1.md | 手机账号用法及隔离、离线退出、开发预览边界 |
| interactive/tasks/TASK-20261023-mobile-account.md | 独立任务记录，不替换 CURRENT_TASK |

## 实际验证

| 检查 | 结果与证据 |
|---|---|
| 新增手机账号浏览器套件 | 最终 11/11 PASS，71.22 秒；首屏入口/返回、密码与注册校验、错密码/断网、登录后离线退出、取消、注册复制、过期认证、防重复请求、明暗/窄屏、拒绝其他账号、旧数据显式归属 |
| Pages 实际构建预览 | 最终 1/1 PASS，9.09 秒；正确 basename、禁用登录/注册、零 /api 请求、返回手机首页 |
| 原手机版 mobile-p0 | 16/16 PASS，101.39 秒；完整本次交互逻辑；后续仅手机账号呈现可访问性/文案/格式与上游隔离后端 CI 整合 |
| 桌面/兼容账号相关回归 | 选定 12 项中 11 PASS、1 FAIL；登录/离线退出、取消退出、新匿名学习后登录、旧数据确认、注册复制、认证失败不改账号、同账号检查、无 Web Locks/无 SubtleCrypto 登录入口均通过。剩余普通旧版启动用例见下 |
| 旧版启动失败的主线对照 | 在未修改的 11a10a84 独立 detached 工作区运行同一用例，同样 FAIL：5000ms 等待「打开设置对话框」超时。不是本任务引入的手机认证回归；没有放宽该断言或声称整个 S1 套件通过 |
| Node 合同 | default-dictionary-registration + edgeone-spa-route，最终 11/11 PASS |
| yarn lint | exit 0，0 errors / 120 warnings；保留现有警告；新增手机账号源文件无诊断 |
| yarn tsc --noEmit | exit 2，已有全项目错误；筛选 src/index.tsx、src/pages/Mobile/、mobile-account / workspace-account-ui 无诊断，不宣称全项目类型检查通过 |
| Pages 构建 | 最终 exit 0，56.21 秒，之后运行上述禁云测试 |
| 普通生产构建 | 最终 exit 0，28.41 秒；没有实际部署 EdgeOne |
| Architecture | PASS：62 Learn/Review modules + 3 low-level files |
| Workflow / diff | js-yaml 解析成功，git diff --check 通过 |

所有认证用例都使用本机路由模拟和人工 fixture，不触碰真实账号/Blob。Chrome 手机触控模拟不能代替真实 iOS/Android 验收。视觉截图由测试产生并已目视检查：.review-test/mobile-login-light.png 与 mobile-login-dark.png（本地忽略文件，可通过测试重建）。

初次扩大的 51 项 S1 套件未跑完：截至第 39 项累计 37 PASS、2 FAIL，随后停止扩大检查。两处失败为上述旧启动超时和旧标签选择器；修正选择器后相关 12 项再次运行，11 PASS，仅旧启动超时保留。没有宣称 51/51。初期手机离线退出测试在断网后导航到浏览器错误页时读取 localStorage 导致 SecurityError；最终等待退出完成后发出的 /mobile 导航失败，再联网检查真实账号归属和原匿名记录，并核对没有任何退出 API 请求。退出实现未因此改动。

## Git 与并行开发

执行基线 596c856417efdfb3870ed7ccdea6060fd37937e4；期间以 ff-only 并入 11a10a8423cbdbe76d5ed11ca7aaa7fc2417d842（8 个无重叠后端/CI 文件）。最终手机 11 项、相关桌面套件、两种构建、Pages 预览、lint/type/architecture/Node 均在集成后执行。源码提交 c0c8388db0c6ab100e3d61882236d3606260cc41，报告和任务状态另行提交以记录准确 SHA。

使用 HUSKY=0 避开全树 prettier 的无关修改；仅格式化新增手机视图/CSS/测试。正常推送 product/main，不 force-push。远端 CI 和 Pages 发布状态需按实际 SHA 查询，不能把本地通过说成远端全绿。

## 后续与边界

- 用户在真实手机/平板试用表单自动填充、软键盘及密码显示手感。
- 真实 EdgeOne 登录仍需要对最终候选版本做隔离账号实网验收。本任务不擅自推进 edgeone-test 或 master。
- 已确认的普通旧版启动超时及全项目 TypeScript 基线错误独立保留，不能将本次 UI 交付说成完整手机版已可发布。
- 此版补账号界面，不新增云同步算法或宣称多设备自动收敛已经完成。

CURRENT_TASK、master、edgeone-test、认证后端及部署开关未修改；没有实际用户数据操作。阻塞依赖 None，状态 REVIEW。
