# QWERTY Plus | M2→M3→M4 全设备无分叉学习记录实施记录（2026-10-21）

## 产品级不变量

用户在登录同一个不可变账户 ID 后，手机、电脑和混用的学习历史必须可以无损汇合；绝不要求用户二选一覆盖别的设备的学习记录。EdgeOne Blob/KV 没有可依赖的跨设备原子写，不能把 V4 完整快照 last-writer-wins 当作“自动同步”。

FSRS-6、Acquisition、成就和每日学习进度只能从同一份已验证的学习历史确定性派生；本地设备的当前页面、键盘/轻触偏好、活动会话游标不应由另一台设备覆写。网络尚未收敛时，允许显示“本机已保存/同步中/等待其他设备”，不得显示“所有设备已同步”。

## 本轮已落地（仅 product/main）

1. **M2.2 见证事件接收器**：\`src/sync/m3-witnessed-receiver.ts\` 在服务器 \`verify-set\` 确认后，按精确 immutable receipt 沿每台设备的链逐段读取；重新验证账号、设备、序号、内容、前驱、UUID、服务器跨设备证据摘要。任一缺失或异常都拒绝返回可用子集。
2. **M2.3 浏览器所有权校验**：\`src/sync/m3-witnessed-browser.ts\` 绑定 S1 工作区账户 ID、generation、token，所有 await 前后重新验证。它只读原始 WordRecord 并返回临时 FSRS 投影；不会写 IndexedDB、V4、云端或 UI 学习进度。
3. **M3.9 有界后台 append pilot**：\`src/sync/m3-publication-cycle.ts\` + \`m3-publication-browser.ts\` 使用已有全量补扫 + Outbox + exact POST/GET readback，每次最多两批；失败保留原始事件及同一 inflight batch，不进行 V4 overwrite。
4. **触发**：\`src/utils/db/index.ts\` 在 WordRecord 持久写入成功后，仅当 \`VITE_QWERTY_M3_PILOT_AUTO=true\` 时动态加载发送调度。调度器再确认来源 hostname **严格等于 \`etest.edgeone.dev\`** 才启用（默认全部关闭）。后台 12s debounce，不阻塞学习 UI。
5. **M4 故障样例**：\`tests/cloud/m3-witnessed-receiver.test.mjs\` 覆盖三设备/重放去重、伪造摘要、不同账号、旧 POP、身份切换、链断裂和冲突；\`tests/cloud/m3-publication-cycle.test.mjs\` 覆盖被拒绝 ACK、离线、换账号、已完成 Outbox、批次上限。

## 严格不能误报的状态

- \`uploaded-events-only\` 只证明**已上传并精确读回部分本人事件**；不代表别的设备已见到，不代表已合并到本机，不代表 V4 六张表已收敛。
- \`status: witnessed, publishReady:false\` 只证明**已知的设备链前缀**完整且与服务器 digest 一致。Blob 列表是最终一致的，暂时没出现的第三台设备不会自动被认为不存在。
- M2 现有 \`v4-event-convergence.ts\` 仅以临时 numeric ID 重放单词 FSRS，不能用它直接覆盖 six-table V4。
- 单台设备内成功切换轻触/键盘是**学习方式融合**，不是手机、电脑物理隔离 Origin 的云端数据融合。
- GitHub Pages 版本禁用云；未在 \`etest\` 明确打开独立认证和事件 pilot 前，无任何自动上传行为。绝不为“能同步”移除上述保护。

## 发布到 etest 之前的阻塞项 / M2 剩余工作

1. 对**六表 V4**实现可验证重建：wordRecords、chapterRecords、reviewRecords、reviewWordStates、achievementEvents、achievementStates；兼容缺 UUID 的旧历史必须依据可靠共同祖先判断，禁止按相似时间戳误删，已存在的 \`v4-foreign-key-projection.ts\` 仍为只读。
2. 并发同词复习评级仲裁：保存每条不可变证据，但不能对同一实际测试双重奖励 FSRS；需要验证事件时钟误差、顺序和终端 probe。
3. 区分**发现不完整**与真正一致：跨 POP 隐藏批次、设备链同序号 fork、已删除账号/会话撤销、离线积压、孤立设备重装，不能因为 \`observed\` 列表目前没有其他批次就宣告完成。
4. M4 持久恢复事务：导入前必须备份本地可回滚六表和完整 Session/设置；任意 Crash / Revision 冲突可重新读回核实；不破坏圈子、成就和跨 Tab Writer S1。
5. 上述 gate 完成后，再通过 etest 的临时账号真机/真实 Blob 测试，验证两手机、两电脑及手机+电脑；主站 \`master\` 仅在完全符合条件时发布。

## etest 临时开关

发布测试代码前必须先具备单独隔离的 etest Blob 和环境。M3 事件服务器需要 \`MULTI_DEVICE_AUTH_ENABLED=true\` + \`MULTI_DEVICE_EVENT_PILOT_ENABLED=true\`，客户端还要显式设置 \`VITE_QWERTY_M3_PILOT_AUTO=true\`，并通过 etest 专用验收。**启用服务器独立认证可能使旧的 V4 快照写入被安全阻止**，不能在现有正式用户站点随意开启。

暂不主动推送 \`edgeone-test\` 和 \`master\`，直至完整 six-table merge、预检/回滚协议和账户自动接续门禁满足。

## 2026-10-22 增量：M2.4 冲突仲裁门禁与六表只读候选

代码仅提交到 `product/main`，无 EdgeOne 开关、无 IndexedDB 写入：

- `src/sync/v4-event-convergence.ts`：独立设备同 `(dict,word)` 在 60 秒模糊窗口内存在两次可能推进调度器的 Review（含无评级门禁的历史记录）时，返回 `concurrent-review-conflict`，拒绝 FSRS 两次评级（包括重复 Good 或 Again）重放；相同 UUID、其他词库、非合格训练不误判。**60 秒只是保守冲突门禁，不是用户真实练习相同的数学证明，更不是最终仲裁结果**。没有可验证的挑战组身份前，严禁猜测保留哪条 Good。事件原样保留。
- `src/sync/v4-six-table-projection.ts`：基于既有 `projectV4ForeignKeys` 与 `projectUuidLearningConvergence`，加入剩余两表的 read-only audit。`reviewWordStates` 仅从经验证的单词事件重放，检测无法解释的 reviewCount、手工排除、旧调度状态和重复主键，失败即拒绝；`reviewRecords` 的原始 ID 按本机/远端单独标记，仅提供 `sessionEvidence`，**不伪造可恢复的 ReviewRecord 合并数据**。
- `tests/cloud/v4-event-convergence.test.mjs`、`tests/cloud/v4-six-table-projection.test.mjs`：同词并发、跨词库、重复 UUID、悬空复习状态、手工排除、Session ID 撞号、源快照只读契约。
- 任何 `status:'projected'` 的输出仍有 `publishReady:false` 和 `convergenceComplete:false`；不能把这份候选写入六表或展示为已同步。

**下一阶段阻塞**：建立来源可验证的跨设备挑战/Session 身份和共同祖先，确定 ReviewRecord 去重/接续语义；补足 FSRS 冲突仲裁与旧历史重放证明；最后才可以做独立事务 journal + crash/rollback 和 etest 实网验收。EdgeOne Blob 的最终一致列表不得当作设备全集。

### M2.5 Session UUID 与终态压缩保护（2026-10-22）

- 新产生的 `ReviewRecord` 在构造时由安全随机源分配 `sessionId` (UUIDv4)；Dexie 自增 `id` 仅作为设备内主键，不参与跨设备身份判断。`review-session-identity.ts` 复用现有 CSPRNG 实现；历史 Session 缺 UUID 时保持缺失，不按时间戳或本地 ID 填补。
- `compactFinishedReviewRecord` 保留新 UUID。终态 Session 允许 `index>0` 且 `words=[]`（既有历史压缩约定），未完成的 Session 不豁免游标越界。
- 六表只读投影对每端重复/畸形 UUID fail-closed；跨端相同 UUID 及完全一致 Session 内容可标记 `matchedSessionPairs`，但仍**不能作为合并授权**。如果 UUID 相同但进度游标或任意内容不同，直接拒绝本轮候选，并保留双方原始数据。
- 保持 `publishReady:false` / `convergenceComplete:false`；已匹配 UUID ≠ 已有共同祖先证明。尚未实现跨设备 Session 游标自动接续、离线并发冲突仲裁和六表恢复事务。真实 EdgeOne Blob 测试需等这些门禁通过后在隔离 `etest` 进行。

### M2.6 共同祖先三方 Session 候选 + 六表联合检查（2026-10-22）

代码实现于 `src/sync/v4-session-three-way.ts`、`src/sync/v4-six-table-projection.ts`，测试实现于 `tests/cloud/v4-session-three-way.test.mjs` 和 `tests/cloud/v4-six-table-projection.test.mjs`。

1. **祖先必须外部验明**：调用方需独立确证账户所有权、共同祖先 V4 来源、完整快照和已钉住的祖先摘要；`pinnedAncestorDigest` 只保证输入的 Session 行与钉住的 bytes 一致，**不能单独证明祖先真实属于两设备**。未取得可信祖先时绝不能调用写入路径。
2. **三方冲突规则**：`local==base, remote!=base` 只生成远端候选；反之生成本机候选；两端相同更新仅产生一个候选；两端各自推进成不同内容、祖先缺失、终态倒退、会话身份/不可变头变化立即阻断。新出现的不同 UUID 并列保留，不按时间戳推测同一 Session。
3. **历史行保护**：缺 UUID、重复 UUID、同一设备重复数字主键全部阻断；不能从时间推测旧记录身份。终态压缩后的空 `words` 与完成游标允许存在，但没有因此可推断其它设备已经完成。
4. **接到六表预览**：`inspectV4ThreeWaySixTableCandidate` 先运行祖先三方检查，再联合检查单词不可变事件、章节与成就外键、FSRS 重放及全部 Session 来源。默认 `projectV4SixTableEvidence` 对相同 UUID 分叉仍维持严格拒绝；独立三方门禁通过才允许*只读候选*标记。
5. **安全边界不变**：所有结果 `publishReady:false`、`convergenceComplete:false`；不修改 IndexedDB、原 V4、每日 Session 游标或云端，不能据此报告多设备收敛。

**余下关键阻塞**：落实由服务器及 S1 授权的真实 common-ancestor 读取，补足缺 UUID 历史的可验证祖先重键（不可凭数字碰撞猜测），同词并发复习挑战组仲裁、六表事务导入/回滚和最终一致性设备枚举审计，随后才可启用 etest 的隔离试验。

### M4.1 完整 V4 事务与回滚底座（2026-10-22）

- `src/sync/m4-merge-transaction.ts`：提供**独立、尚未激活**的六表事务核心；读取并验证完整原始 V4 的指纹后，在破坏性导入前要求`journal.stage`持久保存 **候选+原始回滚快照**。导入后从真实 RecordDB、DailySession、设置和导航重新捕获 V4 并核对指纹，之后才允许`seal/finalize`。
- `src/sync/m4-merge-journal.ts`：复用 S1 Workspace Vault 的 `registry/snapshots` 两个 object store，通过单个 IndexedDB `readwrite` 事务原子保存 rollback 档案及待提交候选。重读时校验完整 SHA、所属账户和 S1 generation；finalize CAS 校验后保留独立 rollback 档案，`apply` 时失效化旧版 S2 snapshot baseline，**不发布云端任何数据**。
- `src/sync/m4-merge-browser-recovery.ts`：实现受 S1 独占写入锁约束的真实 V4 导入/校验适配器，仅接受显式`apply`或`rollback`；尚未被启动入口调用。故障时不删除 journal；恢复完成后才可以清除 journal 并要求重新挂载应用。
- 旧版`manual-v4-import-journal.ts`和`v2-pull-journal.ts`在新事务挂起时拒绝另一个导入/拉取事务，防止两种恢复动作同时操作本地 V4。
- `tests/cloud/m4-merge-transaction.test.mjs`覆盖原始指纹变化、跨账号、六表缺失、持久化后崩溃、导入中崩溃、回读不一致、seal/finalize 中断、恢复重试、显式回滚和 journal 篡改。

**不得误判为可发布**：本轮只有事务核心和隔离 Vault port，还没有受信任的共同祖先取证/六表真正可恢复候选，现在 S1 启动前检查已发现挂起的 M4 journal；S1 generation、当前登录账户和完整 V4 指纹都匹配时，会在挂载任何数据写入者前**重放已暂存的 V4 候选，核对六表和设置后强制重新加载**。账户不一致或 journal 损坏则阻止挂载。注意：这只恢复先前已存储的事务，不启用新的自动合并或云端写入，因此仍没有自动合并可执行入口。已添加真实 Chromium/IndexedDB 的候选应用、断电模拟回滚及互斥测试；仍需通过浏览器门禁、可信共同祖先与真实六表融合闭环才能启用 etest。整个实验默认不执行任何新写入行为。

### M2.7–M2.8 保守 V4 快进与 S2 Pull 祖先存证（2026-10-22）

开发提交在 `product/main`；不会触发 EdgeOne etest 或正式站发布。

- **整份 V4 快进候选（只读）**：`src/sync/v4-fast-forward-preview.ts` 验证不可变账户 ID、6 张表的 manifest + 实际数据分组、Dexie schema 与钉住的祖先 SHA。祖先相同且只有一端变化，可生成**原封不动的整份 Backup V4 快进候选**，不必把章节和 ReviewSession 的本地数字 ID 错误拼接；两端独立变化则返回 `both-devices-changed-requires-six-table-merge`。它包含完整 settings/每日 Session，因此不同本地状态也会保守阻断而不是悄悄覆盖。候选深拷贝、`publishReady:false`、`convergenceComplete:false`，不得直接调用 M4 写入。
- **已验证祖先持久留存**：`v2-pull-journal.ts` 在已验证 S2 Pull 完整恢复之后，原子提交云端基线+待写入日志清理时，同时在 S1 vault 的 `snapshots` 存档对应的**完整云端 V4 祖先副本**（每账户保留最近一次 S2 Pull 存证）。仅记录该设备真实恢复过的云端 revision、V4 指纹、账户及 S1 generation，不复用未知格式，不从本机时间推测祖先。
- **祖先读取二次校验**：`src/sync/m2-pinned-s2-ancestor.ts` 读取时验证当前 S1 账户、存证元数据、完整数据指纹，且要求当前 S2 baseline revision+fingerprint 与存证严格一致。之后 Push/Noop/M4 导致基线变化，旧存证不允许继续被视为当前祖先。损坏数据直接报错，不会变成空历史。
- **回归**：`tests/cloud/v4-fast-forward-preview.test.mjs` 覆盖本机/远端单端变化、双端冲突、伪造 SHA、跨账户、缺失六表、Dexie schema 变化、不丢弃不同 UI/每日状态；`tests/e2e/workspace-v4-m2-ancestor.spec.ts` 使用真实 Chromium IDB 验证 S2 Pull 后祖先和 baseline 一起落盘、跨刷新读取、基线失效、归档内容篡改阻断。
- **严格证明边界**：本地有原始 V4 与服务器曾经确认的 revision，只说明**本设备**曾经在该云端版本恢复过数据。不能证明远端设备也拥有同一父本，更不能证明 EdgeOne Blob 已枚举全部设备。要执行任何双端三方合并，还必须有第二设备的独立可核实父本见证、完整设备事件链和跨 POP 收敛证据。暂无自动六表写回/云端发布入口。

### M2.9–M2.11 第二设备 checkout 存证（2026-10-22）

当前仍仅在 `product/main` 开发，未部署 etest/master。实现分三层：

1. **双设备门禁（只读）**：`src/sync/m2-two-device-ancestor.ts` 不把两个相同 SHA 或已认证 M3 事件链误判成共享历史。只有本机 S2 Pull 存证完整、不同远端 deviceId 的 checkout 回执经独立账户 API 精确认证、云端 revision+指纹一致、远端事件链前缀被服务端精确读取认证时，才继续检查完整 V4 的快进候选。任何双端不同修改仍拒绝走快进。结果永远 `publishReady:false`、`convergenceComplete:false`。
2. **服务端回执**：`cloud-functions/_shared/device-checkout.js` 创建独立的随机 UUID 回执和 SHA-256 内容寻址；服务端 `core.js` 从已认证 session 提取**账户和设备 ID**，先核对当前云端 V4 revision/指纹，以及真实的 M3 链式事件头，再保存并按精确键回读；Blob 存储隔离在 `users/{accountId}/device-checkouts/v1/`，不依赖 list 或 atomic CAS。账户删除同时清除此目录。
3. **API 与浏览器只读连接**：试验接口 `POST /api/sync/events/v2/checkout` 和 `GET /api/sync/events/v2/checkout?deviceId=...&checkoutId=...&sha256=...` 受现有 `MULTI_DEVICE_EVENT_PILOT_ENABLED` 开关限制（默认关闭）。`src/sync/api.ts` 暴露 API；`src/sync/m2-two-device-browser.ts` 校验 S1 generation、当前账号和 token 不变，从 vault 取本机真 S2 Pull 祖先，精确读取远端回执并再次通过已有 M3 verify-set 核实事件链前缀。这一桥接不在普通 Learn/Sync UI 中调用。
4. **证据范围必须严格区分**：回执表示**某个真实认证设备会话向服务器申报了自己使用的云端版本**，不是可信执行环境 attestation，无法从网络独立证明浏览器 IndexedDB 的本地内容完整，也不能证明所有设备、所有 POP 的事件已列举完整。若远端版本已被更新，服务端只接受当前可验证版本的新申报；旧版回执按精确 key 查询但不自动适用未来合并。
5. **仍缺关键闭环**：对活跃/刚注册的设备实现真实 S2 下载完成后的自动回执提交、定义远端当前完整 V4 来源和长久可验证的历史基线、两端不同修改的 FSRS/Session/Chapter 冲突仲裁、M4 事务写回准入及跨 POP 实网验证。绝不将只读候选伪装成可写回的融合结果。

## 完成判据

- 本机保存 -> 事件批次永久稳定 -> 另一设备验证/下载 -> 六表合并 -> FSRS replay -> 前台继续学习。
- 两设备先后/同时/离线学习，最后得到同一 \`(workspace,dict,word)\` 历史和调度结果。
- 重试重复事件、不完整列表、掉电/崩溃、不一致修改，原始历史不丢失；不可合并时保持单机正常学习并明确说明同步未完成。
- 账户登出切换不能跨账号泄露、合并或复写。

## 2026-10-22 对齐审计：避免重复实现与互相覆盖（执行前必读）

> 本节以截至 `product/main=f4918eb8b8a906c650c666af0b4f4f7b4fe05cfe` 的真实代码、etest 云端实测及 GitHub CI 为准。本文早期“尚未实现”“未经 etest 实测”等表述是各开发阶段的历史快照，不应在后续任务中当作最新结论；优先按本节核实后执行，不删除历史过程证据。

### 已实现与证据（不得重复开发）

| 能力 | 现有实现/证据 | 截至该提交的实际边界 |
|---|---|---|
| S1 账户隔离与独占写入、S2 完整 Backup V4 | 既有 `workspace-vault`、S2 Pull/Push、V4 备份协议 | 正式站既有同步能力；不要重做账户模型、V4 编码或迁移 |
| M3 不可变事件/outbox 与认证读回 | `m3-publication-cycle.ts`、`m3-publication-browser.ts`、`m3-witnessed-receiver.ts` | etest 专用开关，事件已上传不等于多设备完整收敛 |
| 确认过的真实云端 CAS 写回（不是模拟） | `tests/cloud/etest-safe-v4-merge-writeback.mjs`，`edgeone-test` 提交 `bd5c3d7bd7d7d7f720d48601007f7388d9154409`；Actions run `39704080782` 为 **success** | 临时独立账号：Revision 409 防旧版本覆盖、Good/Again 同词事件完整保留、FSRS-6 复算、完整六表 V4 Blob CAS 写回、第二设备独立读回均 PASS。仅是受控实网测试脚本；不代表普通浏览器已自动触发 |
| M2 祖先与会话证明 | `m2-pinned-s2-ancestor.ts`、`m2-two-device-browser.ts`、`v4-session-three-way.ts` | 共同祖先认证、checkout 见证与 UUID ReviewSession 三方仲裁均有代码；不可把仅有 SHA 相同或服务器事件链前缀当成全部设备已收敛 |
| 完整 V4 候选与同词 FSRS 归并 | `v4-disjoint-word-candidate.ts`、`v4-event-convergence.ts`、`v4-word-scoped-convergence.ts` | 单端合格 Review 亦重放核验 FSRS；跨设备同词不按 1 分钟窗口删除事件；ReviewSession 的两端独立新增、单端推进可三方合并；仍 `publishReady:false`、`convergenceComplete:false` |
| M4 本地事务与掉电恢复 | `m4-merge-transaction.ts`、`m4-merge-journal.ts`、`m4-merge-browser-recovery.ts`；P4b Browser Recovery Gate success | 完整原始快照+候选先 journal、后 restore/readback/seal/finalize，挂起事务可恢复；**尚无普通自动合并入口**，不得重复实现另一个互相竞争的导入 journal |

### 当前分支与门禁（禁止混淆）

- `product/main` HEAD 为 `f4918eb8b8a906c650c666af0b4f4f7b4fe05cfe`，比 `edgeone-test` 领先 6 提交，比 `master` 领先 146 提交；`edgeone-test` HEAD 是 `bd5c3d7bd7d7d7f720d48601007f7388d9154409`，`master` 是 `6d7839b9a9fd7a31459a19aeca948227b1f7b3c2`。下次执行时必须重新读取分支 SHA，不得默认仍是这些值。
- `b4035403f2b3864eef0d5dc8d4540a2735f1bcf5`：Cloud Sync Gate、etest 只读准入、P4b Browser Recovery Gate PASS。
- `f4918eb8...`：Published Dual-Site Explorer 与 Pages Explorer Agent PASS；**Review Gate FAILURE（91 通过、2 失败）**。失败点为 `navigation-dialogs.spec.ts` 对两个 `header` 的 strict locator，以及 `settings-mode-navigation.spec.ts` 仍寻找旧手机学习入口文案“进入沉浸学习页面”；不应把这两项说成同步算法失败，也不得跳过完整 Review Gate。需先将测试断言与现 UI 语义对齐，并重新验证。
- 正式站 `master` 未包含本轮 M2.15/M2.16 代码，最新 `product/main` 的浏览器行为不得被说成正式站已上线。

### 后续最短路径：只补连接，不推翻现有实现

1. **P0 恢复工程绿灯**：修复上述两个过期/不唯一的 UI 断言，只改测试或确认实际 UI 缺陷；完整 Review Gate、Cloud Gate、P4b 和双站 Explorer 分别检查。避免其他 Agent 同时改这些测试文件。
2. **P1 收紧可恢复六表候选的边界**：直接复用 `v4-disjoint-word-candidate`、`v4-session-three-way` 及 FSRS replay。只补章节、成就、DailySession 与实际跨设备数据的阻断/仲裁缺口；不以简单时间窗口去重，不更改 FSRS-6 正式算法或账户 ID。
3. **P2 浏览器受限编排**：复用现有 S2 远端快照读取、独立 checkout/事件凭据核验和 etest 已证明的 Revision CAS 写回，再与 M4 持久 journal/原位 restore 串联。入口须绑定同一 S1 账户+generation、真实写入锁、当前本地快照指纹及云端 revision；每次异步边界重新核对所有权；云端写回后精确读回，无全设备收敛证明时不能显示“已同步”。遇到 409、5xx 不确定提交、断网与页面崩溃，保留原始事实和回滚凭证后核实/重试，不直接覆盖。
4. **P3 etest 分阶段验证**：先纯只读 dry-run 和确定性合同测试；再隔离临时账号真实 CAS→另一设备读回→本地 M4 恢复，覆盖两手机、两电脑及混用、同词不同时/同时学习、账号切换、离线、跨 POP 不完整可见性。默认功能开关关闭，不让 etest 影响正式 Blob。
5. **P4 发布边界**：只有该 SHA 下完整 CI、真实 EdgeOne 后端和浏览器恢复门禁均 PASS，且无自动覆盖风险，才讨论 `edgeone-test` → `master` 发布。未经额外发布指令不推送正式站。

### 每项未来开发的开工审计表

- 先查询现有类/函数、调用链、测试、部署开关与对应历史提交，明确是「已存在、仅测试、仅只读、已接入真实浏览器、生产已启用」哪种状态。
- 任务写清楚**复用入口**、**唯一新增边界**、**禁止触碰的模块/分支**、**验证场景**、**失败时如何保留旧数据**。不再将“补编排”变成“重写 CAS / 重造 journal / 重设 FSRS”。
- 每次提交前重检目标分支 HEAD；若并行 Agent 已改动目标文件，停止直接覆盖，重新审计差异和合同测试。按最后提交的精确 SHA 关联门禁，不引用旧 commit 的 PASS 充当新版本验收。

关联实测：https://github.com/smhe00/qwerty-learner/actions/runs/39704080782



## 2026-10-22 回滚后安全续接检查点（3547113 → 29577be）

- **恢复确认**：恢复提交 `3547113f08333880fe5f9490b4afc730851b1e86` 的 tree SHA 与用户指定的 `959b8c9328c1ed02207a6f9f728e04866759699d` 完全相同（`1d8b34218e6c7900e7938e65f654b88297c419f7`）。已撤销 `89a7208..1db71fd` 九个后续错误方向实验提交；不得从那些提交恢复未审查的自动采纳/覆盖流程。
- **分支**：恢复时 `edgeone-test` 同指向 `3547113`，正式 `master=6d7839b9a9fd7a31459a19aeca948227b1f7b3c2` 未改。恢复提交的 Cloud Sync、P4b Browser Recovery、etest read-only admission、Learn Real Journey、Dual-Site Explorer 和 EdgeOne Cloud E2E GitHub Actions 均已有成功记录；Review Gate 在恢复后运行成功，另有其余较长的 browser gate 需按最终 SHA 核验。受控云端 CAS 写回的真实成功证据仍是 `959b8c9` 的 etest run `39767760596`。不能把这个成功误写成用户无感自动合并已上线。
- **唯一新增边界 M2.12**：`src/sync/m2-checkout-declaration.ts` 仅在可信本机 S2 Pull 存证、匹配的实时云 V4 revision/fingerprint、精确认证的 M3 本设备事件头成立时，允许向既有 checkout API 提交独立设备声明；必须对服务端新回执 GET 精确回读，并在每个异步边界复核 S1 owner。此类成功只允许返回 `declared-checkout-only` + `publishReady:false` + `convergenceComplete:false`。
- **适配与开关**：`m2-checkout-declaration-browser.ts` 只提供显式可调用的 etest-only 门禁适配函数，复用现有服务端 `POST/GET /api/sync/events/v2/checkout` 和 S1/M3 元件；未连接普通 Learn、S2、M4 或任何后台定时器，生产站默认不触发。
- **测试**：`tests/cloud/m2-checkout-declaration.test.mjs` 覆盖成功存证与身份、伪造事件头、失效云版本、修改本地祖先、服务器错回执、超时及写后身份切换。此条记录只证明代码和测试已提交；最终 PASS 必须以对应 GitHub Actions run 的结果为准。
- **明确保留**：已有 immutable UUID 事件归并、FSRS-6 重新计算、六表候选、ReviewSession UUID 三方仲裁、已有云端 CAS/409 确认写回、M4 Journal / Crash Recovery 均不改、不重造。DailySession/章节/成就跨设备独立变化仍为保守门禁。
- **下一步**：核实当前提交的完整 CI，检查已存在 outbox durable `confirmedHead` 的所有权与稳定读接口，给该 checkout 入口增加一次性受控调用/receipt 持久化机制；随后建立真正的只读跨设备候选编排，完成非丢失验收后才设计自动 M4 采用和云端 CAS。未经进一步 gate 不允许 claim “all devices synced”，且绝不触碰 `master`。


### M3 → M2.12 自动存证试验闭环（2026-10-22 后续）

- 仅 `VITE_QWERTY_M3_PILOT_AUTO=true` 且域名为 `etest.edgeone.dev` 时，在原有 M3 已确认的上传批次耗尽、Durable Outbox 确认无 pending/inflight 且 device `confirmedHead` 存在后，触发独立 checkout 声明及精确回读。出错、离线、身份切换、云 revision 变化只记录阻断，不清空 outbox，不影响本地学习。
- 新增纯逻辑 `src/sync/m3-checkout-cycle.ts` 和独立合同测试；`m3-publication-browser.ts` 复用本地 outbox、M2.12 的隔离浏览器适配，不创建新的同步算法/新的 Journal；仅允许 `declared-checkout-only`，`publishReady:false`，`convergenceComplete:false`。
- **强制边界**：checkout 只是两端明确祖先的证据之一，不保证其他设备已经发现、不代表六表自动合并完成。当前普通生产页面与 `master` 不启用；没有独立六表可恢复候选 + M4 与完整 CAS 事务和 409/断网/跨 POP 实测前，不准宣称无感同步完成。

### 六表候选出口的独立学习证据守恒门禁

- `v4-lossless-evidence-audit.ts` 在 FSRS-6/Session 三方归并结束后，独立复核三份来源 Backup V4 的全部 `attemptId`，候选必须存在**恰好一次且不可变事实完全一致**的并集；设备内 numeric ID 和 FSRS shadow 可以重新映射，源数据不改写。
- 同时核对 `ReviewSession.sessionId` 并集与祖先无 UUID Legacy 行的字节级完整保留；被遗漏、伪造、重复、跨设备同 UUID 不同证据的候选即使通过 FSRS 缓存校验，也明确阻止进入候选出口。
- **范围**：这是必要条件而非充分条件；章节、成就和 DailySession 的独立修改仍由原有保守合并门禁阻断。没有改变对无共同祖先设备的保护，不提供 cloud writeback 或自动 M4 restore 授权。


### M3.9 连续自动恢复（仅 etest opt-in，2026-10-22）

- 新增 `m3-continuous-drain.ts` 纯调度器，在 S1 成功挂载的 etest 账号页启动：首次延迟 2 秒、闲置 45 秒扫描、批次未清 1 秒续传、失败指数退避至 120 秒；网络恢复和可见性恢复自动触发补扫。与现有 Learn WordRecord debounce 并存，实际同一浏览器仅允许一个 M3 publication Promise。
- 生命周期 `pagehide` 中止后续定时器/事件监听；完成正在执行的网络调用也不产生新的定时器。每一次 IDB / 网络异步均继续受现有 S1 owner/account/generation/token 校验。
- M3 仅证明不可变事件已交付；没有启动跨端完整事件自动发现，没有打开六表云端/本地自动覆盖；M1/M3 后端环境试验开关仍需独立 etest 验证。普通 production/master 和 Pages 不会启动此调度器。


### M2.17 DailySession 按词典保守三方融合（2026-10-22）

- 新增独立纯函数 `v4-daily-session-three-way.ts`，与现有完整 V4 事件合并候选连接。允许不同词典分别在两个设备新增会话；允许同一词典只有一端推进、另一端保持共同祖先；允许两端完全一致的推进。不选 max(index)、最新时间或状态较大者。
- 同一词典两端创建独立 sessionId 或分别改变进度时必须阻断，不能在单个 `dailySessions[dict]` 槽位内吞掉任一设备的会话；从祖先删除会话和出现未知未来 runtime 字段也阻断。历史 Chapter/Achievement 仍是受保护表。
- 所有输出仍 `publishReady:false`，不授权 M4 本地采纳或完整 V4 云端写回；跨设备同词不同记录完整保留、不重新计数已存 UUID。


### M2.18 ChapterRecord UUID 与 WordRecord 数字外键安全重映射

- 新产生的 ChapterRecord 具有独立的随机 `chapterRecordId`，旧章节记录保留原样，不补写历史、不调整 Dexie schema。
- 并发完成的两端 ChapterRecord 使用 UUID 去重/检查不可变内容，按 `wordRecords.attemptId` 将不同设备的 `wordRecordIds` 映射到候选真实数字主键；不沿用来源端的数字 ID 猜测外键。
- 新章节无 UUID、同 UUID 不同内容、修改/删除祖先、未知外键或指向不同词典，一律 fail-closed。章节可正确归并仅是完整 V4 **只读候选**；云端/本地自动发布仍必须独立验证。
