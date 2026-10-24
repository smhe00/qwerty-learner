---
protocol_version: "1.1"
task_id: "CODEX-P1-AUTO-HISTORY-MERGE-20261024"
status: "REVIEW"
executor: "Codex (single executor)"
target_branch: "product/main"
claim_base_commit: "1bce4bfa2afc4c712338bebc4bb6303293c8100d"
last_commit: "51d2124360b620d6d84742b5359d6991f1f60567"
release_to_master: false
---

# 普通账号分叉由程序自动融合

> 以下为生产发布前的验收记录。用户随后已明确授权将相同 eTest 成功提交发布 master；发布结果见同目录 CODEX-P1-AUTO-HISTORY-MERGE-20261024-master-release.md。

用户要求普通用户无需处理分叉，并要求先合并 main、再同步 eTest。有效同账号完整 V4 分叉现已自动处理。主实现 PR #34，测试就绪修正 PR #35；main 与 eTest 均为 51d2124360b620d6d84742b5359d6991f1f60567。master 保持 a2dc907c9c0f6e8924f441fa360ebabd317233dd，未发布，未操作生产用户数据。

最终版本的真实启动历史下载、两端分叉五条并集、完整六表一致、三台离线学习设备三条并集和 M3 单会话接力均已通过。最终 V4 传输 attempt2、Pages＋eTest release-readiness 亦通过，所有本任务硬门禁完成。认证端点曾出现500以及测试身份的未确认状态仍单独记录。

## 实际同步路径和源码

登录/启动先做 metadata 检查。相同内容走 metadata-only noop；单边更新保留原 S2 push/pull。双方变化或同账号未绑定的非空本机历史，现在下载并验证固定版本的云端完整 V4，在隔离数据库生成融合候选，先归档双方原件和候选，再进行一次 revision CAS，最后通过持久化 Pull journal 在应用挂载前恢复。M3/M4 事件链仍独立运行，其成功不冒充完整 V4 已收敛。

以下行号针对 51d21243：

| 文件位置 | 作用 |
| --- | --- |
| src/sync/v2-manual-executor.ts:115 | 分叉完整下载、校验、自动融合入口 |
| src/sync/v2-manual-executor.ts:129 | 双方原件及候选归档先于云端写入 |
| src/sync/v2-manual-executor.ts:132 | 再确认 metadata 未变化；随后仅一次 revision CAS |
| src/sync/v2-manual-executor.ts:154 | 持久化 Pull 暂存；恢复读回成功前不推进 baseline |
| src/sync/automatic-v4-records.ts:87 | UUID 去重、旧内容最大重数、数字键重新分配 |
| src/sync/automatic-v4-records.ts:183 | 六表候选、章节/影子/成就引用重映射 |
| src/sync/automatic-v4-records.ts:229 | FSRS 证据重建与人工排除保留 |
| src/sync/automatic-v4-records.ts:266 | 成就来源和既得奖励融合 |
| src/sync/automatic-v4-browser.ts:76 | 隔离解码、完整会话/设置策略 |
| src/sync/automatic-v4-browser.ts:136 | 第三个数据库独立导入，复核字段和共享引用关系 |
| src/sync/automatic-v4-archive.ts:31 | 已有原件重新验算指纹；损坏不能覆盖后继续写云 |
| src/sync/automatic-v4-archive.ts:59 | 账号/generation/pending 检查与原子归档 |
| src/sync/multi-device-recovery-browser.ts:39 | M3 仍扫描全量真实尝试，数字键重排不依赖旧高水位游标 |

v2-browser-executor.ts 对旧 base64 V4 使用只读下载，避免先迁移版本制造假分叉。account-login-v4-check.ts 接入融合结果，校验/传输失败仍明确显示尚未完整融合。没有改域名开关、EdgeOne 路由或 Cloud API；正式站限制的原审计见 codex/login-v4-etest-report-20261024 分支。

## 默认决策与保护边界

- 学习事实按真实 UUID 取并集；不同尝试保留。无 UUID 的旧记录按完整逻辑内容取最大重数，不伪造身份。无法证明两份完全相同旧记录是否同一次学习，双方原件完整归档供恢复。
- 复习/每日会话选一份真实、较新或更完整的版本，不拼接游标。充分记录才重算 FSRS；稀疏旧历史保留更丰富的既有状态和保守复习时间。人工排除标记优先。
- 既有成就保留并修正来源引用，不凭空授予奖励。同名并发设置取已发布云端值，保留本机独有设置；导航取云端。
- 原件只保存在账号隔离的本机 Vault，不是额外云端备份。浏览器清理仍会清除它；尚无归档自动清理策略。
- 不把分叉中的缺失直接当作删除墓碑。未知 schema、矛盾 UUID、断裂引用、归档损坏或存储不足仍停止写入。这些保护不要求普通用户处理正常分叉。
- 云端上传响应不明不在同一次调用重放。下次独立同步先验证已发布并集，相同候选只恢复，不再上传。

## 本地与 CI 验证

| 验证 | 结果 |
| --- | --- |
| yarn test:cloud | 583/583 |
| 完整 workspace-v4 浏览器回归 | 119/119，5.2分钟 |
| 自动融合/执行器专项 | 27/27 |
| TypeScript 基线比较 | 原144、当前144，新增0 |
| 应用 lint / cloud lint | 0错误，应用133警告；cloud通过 |
| 构建 | 本地及最终源码 safety CI通过 |
| Safety 40054931858 | cloud、119项workspace、mobile、Review全部通过；最终Learn契约116项通过 |
| Performance 40054956232 / Learn Block Sync 40054956424 | 均通过 |

修复了类型检查脚本把未跟踪新源码误算入旧基线的问题，避免隐藏新错。旧“分叉即停止”的测试改为严格并集、收敛和重复同步断言；并发测试使用同版本 metadata 屏障验证唯一 CAS 胜者。上传确认丢失测试等待真正恢复完成后再读取 baseline，保留记录数/指纹/版本断言。另覆盖损坏已有归档拒绝、共享引用/二进制视图关系、旧记录重数及三设备不同合并顺序。

## 先 main 后 eTest 的证据链

1. PR #34 修复提交 90464c20f3dd97a107dea3bf4495364826916d78，通过完整 safety 后合并 main 得到 46047f53a3397b62950e45689b7d2d97fb5f5b2b。
2. Pages 40055870349、Cloud 40055870335、Etest Admission 40055870337通过，才推进 eTest 到46047f53。
3. 历史测试40056056977 attempt1在A重新登录收到500，未到融合断言；清理登录也500。attempt2用新账号完整通过，双方4条历史自动得到5条、六表一致、原件保留，清理200。
4. 三设备40056056939 attempt1在恢复导航时的会话读取抛出 Failed to fetch，清理200。PR #35仅修改测试：等待挂载完成、容忍导航期间只读探测失败；所有3/3及不可变字段断言保留，不重放任何写请求。修复提交b97c309b64226ad15082105058a4da3a74a4d59c。
5. PR #35先合并 main 得到51d21243，Pages40056739893及Cloud/准入40056739852通过后，才推进eTest到同一SHA。git diff确认src、cloud-functions及EdgeOne配置与46047f53一致。

最终部署的真实证明：

| 任务 | 结果和证据 |
| --- | --- |
| 历史完整V4 40056974487 attempt1 | 通过：普通启动恢复六表，共享引用保留；分叉5条并集；两机六表一致；原件归档；重复启动零新上传；清理200 |
| 三设备40056974457 attempt1 | 通过：三个真实Learn离线分叉，重新登录后各3条且逐条UUID/不可变字段一致；三个pending journal均false；清理200 |
| M3 40056974474 | 通过：单会话A/B/A接力、撤销令牌401和唯一事件并集；finally清理断言通过 |
| Branch E2E 40056974483 | 浏览器4项通过、两账号删除验证通过；传输attempt1注册500、未开始上传；attempt2新身份通过原生/分块传输、SHA、读回与过期CAS保护，两个临时账号清理通过；同SHA release-readiness通过 |
| V4安全子集写回40056056961（46047f53） | 通过：真实Blob、两个过期CAS409、六表join、章节引用、FSRS及独立设备读回；该底层代码在51d21243未改变 |

脱敏原始证明存于同目录 history-proof.json 和 validation-proof.json（以完整任务前缀命名）。仅保存版本、请求种类的断言、计数、状态和清理证据，不含账号、令牌或用户备份。

## 仍需保留的认证/清理异常

真实eTest出现过登录/注册HTTP500。该现象与融合成功是不同结论，不能用重跑通过抹去服务波动，也没有足够后台日志断言其具体基础设施根因。普通数据融合失败仍保留本机记录。

| 范围 | 运行/attempt | 未确认状态 |
| --- | --- | --- |
| 本次 | 历史40056056977 / 1 | 清理登录500，DELETE未发送 |
| 本次 | Branch40056974483 transport / 1 | 首次注册500，创建结果未知，未获可信身份用于删除；未上传V4 |
| 既有 | M3 40043194200 / 1 | 清理登录500 |
| 既有 | 历史40044357407 / 1 | DELETE500，结果未知 |

以上全部是eTest一次性测试身份，未操作生产用户。未重放未知写入/删除，也不把后续新账号清理成功算作旧账号已清理。最终报告分支仅更新文档与两份脱敏证明，不触发重复应用部署。

## 最终交付状态

报告分支：codex/auto-v4-merge-report-20261024，仅4个报告/状态/脱敏证明文件。main和eTest远端均51d2124360b620d6d84742b5359d6991f1f60567；实际Pages完整SHA一致，eTest标记51d2124。正式站标记a2dc907、master完整SHA仍a2dc907c9c0f6e8924f441fa360ebabd317233dd。

最终required runs：40056974487（历史）、40056974457（三设备）、40056974474（M3）、40056974483 attempt2（浏览器/传输/release-readiness）、40056739893（Pages）、40056739852（Cloud+准入）均success。Pages Explorer Agent 40056739851是额外探索，生成报告时仍in_progress，不计为通过，也不用于替代本任务测试。

全部功能/部署工作完成，状态REVIEW交付验收；没有请求或执行master发布。剩余限制为已列出的eTest认证500与未知测试身份状态，未尝试无身份依据的删除。
