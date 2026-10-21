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

## 完成判据

- 本机保存 -> 事件批次永久稳定 -> 另一设备验证/下载 -> 六表合并 -> FSRS replay -> 前台继续学习。
- 两设备先后/同时/离线学习，最后得到同一 \`(workspace,dict,word)\` 历史和调度结果。
- 重试重复事件、不完整列表、掉电/崩溃、不一致修改，原始历史不丢失；不可合并时保持单机正常学习并明确说明同步未完成。
- 账户登出切换不能跨账号泄露、合并或复写。
