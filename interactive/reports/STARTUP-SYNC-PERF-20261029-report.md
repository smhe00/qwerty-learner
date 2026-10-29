# 启动同步性能分析与优化

状态：IN_PROGRESS。执行基线 `c6bab4ebe6c82f665745fa7e9f70579ee05e3ada`。独立于 Circle 性能任务，CURRENT_TASK 不变，不发布 master。

## 启动关键路径

1. 获取本机独占写锁；读取账号空间注册信息；恢复 S1/S2/M4/导入日志；核对归属、会话及存储见证。任何未完成事务都必须先恢复，不能为了速度提前挂载学习写入器。
2. 完整 V4 核对：并发读取实时云端元数据、本机 baseline、本机实际六表/设置/会话摘要、已有审计凭据。凭据、账号、generation、内容摘要、云版本和指纹全部匹配才能跳过导出/传输；否则完整审计、CAS/合并/恢复保持原流程。
3. 发布本机未确认的不可变事件。已有修复避免把刚接收的远端事件重新上传。实际写入仍需要 exact GET 确认。
4. 发现事件收据，再验证已发现的设备链。发现列表仅是提示，不能代表全账号完整性。服务端凭据和客户端实际事件摘要匹配时无需重下载；有增量时完整候选审计和 M4 原始/候选事务归档后恢复。
5. 最后再次检查归属、全部待恢复日志、会话和本机见证；再挂载 App。恢复引起的重载共用 60 秒预算，不因每次重载重置；网络未完成与本机可安全学习是两个独立状态。

`d094a45` 实网历史登录 CI 40811538832：无变化重新登录 31.346 秒，guarded-bootstrap 23.678 秒。其中 V4 meta 5.951 秒、M4 observed 5.573 秒、M4 witness 11.169 秒；本机摘要 52 ms、完整快照审计约 730 ms。父阶段包含子阶段，不能重复相加。总时间还包括登录 HTTP、账号空间切换和导航等，不能将差值全归因于某一个接口。

## 根因与本次实施

主要瓶颈是小请求背后的服务端串行存储 I/O，而非重复学习数据下载。原三个启动接口没有采用 Circle 已验证的 SDK transport 复用和并行鉴权读取。每次完整鉴权依次等待身份、当前会话、撤销标记、凭据版本；同一请求多次鉴权还重复检查已确认的当日活跃标记。SDK getStore 重建客户端也重复初始化 provider credentials。

- 精确限定 GET `/sync/v2/meta`、GET `/sync/events/v2/observed`、POST `/sync/events/v2/verify-set`。只扩展现有安全机制，不扩展到学习写入、登录、删除、普通事件读取等路径。verify-set 的写入仅是可丢弃校验凭据，不是用户学习数据。
- 复用 SDK transport/有期限的 provider credentials；按 store、consistency、project、credential 隔离。绝不缓存 Blob 内容、账号权限或会话判断；保留 SDK credential refresh、所有原有强读取及 handoff wrapper。
- 独立鉴权读取并行，仍逐次实时读取、按原逻辑顺序判定失败；管理员特殊 token 和多会话分支保持原路径。
- 当日活跃凭据仅在单次 HTTP 请求内复用正向结果，清理 fence/deleting 每次实时读取，新写入后复查仍保留。
- 对完全未变化的服务端历史 checkpoint，保留初始鉴权以及 checkpoint 读取后的实时鉴权。移除紧接着、无任何新存储操作间隔的第三次重复鉴权。更改/分页路径的写前鉴权与 readback 后鉴权不变。

## 安全与验证

- 新增真实打包 HTTP gateway 测试：跨账号凭据不可用；未登录/已撤销会话拒绝；读取 checkpoint 时出现撤销或清理标记分别返回 401/423；不泄露成功证据。不变 checkpoint 无重写，初始/最终鉴权保留。
- 增加精确 method/path 与嵌套请求 scope 测试；保留 transport 凭据/项目隔离、失败写入不重放、并行读取失败优先级测试。
- 全量 Cloud 首轮 1046/1050：四个 handoff 用例因测试在同一模块实例中热替换假 Blob 服务、复用客户端仍绑定前一假服务失败。修复测试隔离：每个新假存储配套新模块实例，模拟独立部署。所有原安全断言保留；对应 12/12 通过。
- 修正隔离后完整 Cloud **1050/1050 通过，12.81 秒**。修改后端/Cloud 测试 ESLint 通过，diff whitespace 通过。
- 原生新测试首次使用错误的 publish HTTP 200 预期，按实际创建契约更正为 201 后通过。不是产品修改。
- Playwright 测试可发现/编译。仓库 ESLint 不覆盖 tests/e2e TypeScript，该文件不能用默认 JS parser 评估；保留 Playwright 的编译和远端实际执行验证。
- 历史登录 E2E 增加三次普通刷新耗时，区别重新登录与已登录启动；仍断言一次实时元数据核对、零事件上传/下载、零 M4 恢复及原记录不变。记录本机 proof 命中，暂不人为设一个会因网络抖动失真的时间阈值。

## 远端计划与限制

等待同一源 SHA 的 Cloud、Pages/可见 UI 和 etest 准入成功，再一次推进 etest；历史登录、三次普通刷新和现有九项云端回归均在真实站验证。实际收益尚未测得，不将单测 I/O 减少当作实网耗时。

本次保持 V4→事件发布→发现→验证的顺序。V4 和 M4 可写本机，不能简单 Promise.all；提前观察也可能遗漏本次新发布的头。跨登录复用本机 proof/历史分页缓存涉及 generation 边界，本次保留原规则。没有用固定 TTL 跳过云检查，没有把恢复写入移到已挂载学习页面，没有缩短超时掩盖未完成同步。后续是否需要新的只读组合接口或启动后台化，应由本次实测和明确数据语义决定。

## 精确候选与发布

源提交 `efd4445e9932831d8a14c85d3c67cbc3c97c234a`。main 上 [Pages 双构建可见界面及线上回归](https://github.com/smhe00/qwerty-learner/actions/runs/40820727968)、[Cloud Sync](https://github.com/smhe00/qwerty-learner/actions/runs/40820727929)、[启动恢复](https://github.com/smhe00/qwerty-learner/actions/runs/40820727939)、[Circle Core](https://github.com/smhe00/qwerty-learner/actions/runs/40820728008)、[Etest 准入](https://github.com/smhe00/qwerty-learner/actions/runs/40820727917) 均成功。随后 edgeone-test 从 d094a45 非强制快进到该 SHA。因触及交接测试，此次还触发账号交接 qualification，实际共有十项 etest 自动回归。

历史登录性能运行 [40821640672](https://github.com/smhe00/qwerty-learner/actions/runs/40821640672)。本机首次调用源标记脚本缺少其必需的 GITHUB_REF_NAME 参数而提前退出、未发送请求；补充实际目标分支参数后等待同一 SHA 部署。不将部署等待时间计入启动性能。

## 第一轮实网结果与追加发现

`efd4445` 历史登录 40821640672 成功，六表恢复、两端分叉收敛、无变化登录记录保留和账号清理全部通过。无变化重新登录 **24.299 秒**，较前次 31.346 秒减少 7.047 秒（22.5%）；guarded-bootstrap **15.540 秒**，较前次 23.678 秒减少 34.4%。元数据 3.904 秒、发现 3.434 秒、见证 7.209 秒。属于同一 CI 场景前后各一次实测，网络/运行位置会波动，不代表所有用户固定收益。

三次普通刷新 16.606/13.309/14.591 秒，均保持零事件上传/下载、零 M4 应用和学习记录不变，但 **localProofReused 三次均 false**。证据见 `evidence/STARTUP-SYNC-PERF-20261029-first.json`。因此没有将第一轮当作全部完成。

定位：`startupLocalDigest` 用 WeakSet 将共享引用与循环引用一起判为不支持。历史用例的 reviewRecords.words 中存在 `[shared, shared]`，这是已经被 V4 正确保存的合法数据；摘要返回 null，后续每次都重新导出、scratch roundtrip。此前普通无 alias fixture 的缓存测试覆盖不到。

追加修复：确定性排序遍历为对象/数组/Date 编号，并编码重复引用；活动递归栈仍拒绝循环，未知类型仍完整审计。内容与共享拓扑都进入摘要，不能把同值但独立的两个对象误认为共享对象。不修改数据库或备份格式；旧摘要自然失配一次并经完整审计更新。30 项 startup proof 单测通过；新增真实 Chromium IDB 共享引用刷新/变更回归 1/1 通过，证明缓存命中且 Date/alias 保留，同条数只改变引用关系仍失效。修改源码 ESLint 和 diff check 通过。

第二候选将沿用已通过的服务端优化，并在实网连续刷新中新增“后两次必须命中 proof、零 snapshot-capture”断言；不降低原安全断言。需要重新完成同 SHA Pages/Cloud 准入，再推进 etest；master 仍不发布。
