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

**不得误判为可发布**：本轮只有事务核心和隔离 Vault port，还没有受信任的共同祖先取证/六表真正可恢复候选，现在 S1 启动前检查已会发现挂起的 M4 journal 并**拒绝挂载应用，防止新学习写入覆盖未恢复状态**，但仍未自动执行 M4 恢复，因此目前没有自动合并可执行入口。已添加真实 Chromium/IndexedDB 的候选应用、断电模拟回滚及互斥测试；仍需通过浏览器门禁、可信共同祖先与真实六表融合闭环才能启用 etest。整个实验默认不执行任何新写入行为。

## 完成判据

- 本机保存 -> 事件批次永久稳定 -> 另一设备验证/下载 -> 六表合并 -> FSRS replay -> 前台继续学习。
- 两设备先后/同时/离线学习，最后得到同一 \`(workspace,dict,word)\` 历史和调度结果。
- 重试重复事件、不完整列表、掉电/崩溃、不一致修改，原始历史不丢失；不可合并时保持单机正常学习并明确说明同步未完成。
- 账户登出切换不能跨账号泄露、合并或复写。
